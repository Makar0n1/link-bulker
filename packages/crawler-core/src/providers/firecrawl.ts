import { CrawlError, type CrawlRequest, type CrawlResponse, type CrawlerProvider } from '../types';

/**
 * Firecrawl scrape provider.
 *
 * Wraps the official SDK and normalizes the response shape into our
 * provider-agnostic CrawlResponse. The SDK is imported lazily so test/runtime
 * environments without an API key don't pull network deps at module load.
 *
 * Anti-bot strategy:
 *   1. First attempt: basic proxy (1 credit, datacenter IPs).
 *   2. If the response looks like a bot-trap (very small HTML with no anchors)
 *      OR the basic call threw a `document_antibot` error, retry with stealth
 *      proxy (~5 credits, residential IPs + antibot bypass).
 *   3. If stealth also fails or still returns a bot-trap, throw CrawlError
 *      with a clean human-readable message. The worker will store it as
 *      Link.error and the row will show up as ERROR (not silently as
 *      linkFound=false).
 *
 * Known Firecrawl SDK limitations (verified empirically in Phase 2 smoke):
 *   1. HTTP response headers are NOT exposed. We always return `headers: {}`.
 *      This means X-Robots-Tag cannot be read; only <meta name="robots">
 *      from the HTML body is honored. donorXRobotsTag will always be null
 *      with this provider.
 *   2. For some sites (e.g. Wikipedia) Firecrawl returns a Parsoid-style
 *      HTML rather than the public pageview HTML. canonical/og tags may
 *      be missing. This is a property of the source HTML, not our parser.
 *   3. Redirect chain is reconstructed as [requested, final] when the SDK
 *      doesn't expose it. We never lose the final URL.
 */

const BOT_TRAP_HTML_BYTES = 30_000;
const BOT_TRAP_MIN_ANCHORS = 1;

function isBotTrap(html: string): boolean {
  if (!html) return true;
  if (html.length < BOT_TRAP_HTML_BYTES) {
    const aHrefCount = (html.match(/<a\s+[^>]*href/gi) || []).length;
    if (aHrefCount < BOT_TRAP_MIN_ANCHORS) return true;
  }
  return false;
}

function classifyAntibotError(err: unknown): string | null {
  const msg = err instanceof Error ? err.message : String(err);
  if (/document_antibot/i.test(msg)) return 'Site blocks crawlers (anti-bot protection)';
  if (/cloudflare|datadome|akamai|imperva|perimeterx/i.test(msg))
    return 'Site behind anti-bot CDN';
  if (/timeout|timed out/i.test(msg)) return 'Site did not respond in time';
  return null;
}

export class FirecrawlProvider implements CrawlerProvider {
  readonly name = 'firecrawl';
  private clientPromise: Promise<unknown> | null = null;

  constructor(private readonly apiKey: string) {
    if (!apiKey) {
      throw new Error('FirecrawlProvider: apiKey is required');
    }
  }

  private async getClient(): Promise<any> {
    if (!this.clientPromise) {
      this.clientPromise = import('@mendable/firecrawl-js').then((mod) => {
        const Ctor = (mod as any).default ?? (mod as any).FirecrawlApp;
        return new Ctor({ apiKey: this.apiKey });
      });
    }
    return this.clientPromise;
  }

  private async tryScrape(
    client: any,
    url: string,
    proxy: 'basic' | 'stealth',
  ): Promise<any> {
    return client.scrapeUrl(url, {
      formats: ['rawHtml'],
      // Always full DOM; the parser needs every <a>, <link>, data-* attribute.
      onlyMainContent: false,
      proxy,
      // Stealth mode benefits from a small JS settle window.
      ...(proxy === 'stealth' ? { waitFor: 2000, timeout: 60000 } : {}),
    });
  }

  async scrape(req: CrawlRequest): Promise<CrawlResponse> {
    const client = await this.getClient();
    let result: any;
    let usedStealth = false;

    // ── Step 1: try basic proxy ──────────────────────────────────────────
    try {
      result = await this.tryScrape(client, req.url, 'basic');
    } catch (err) {
      // Basic threw — likely document_antibot. Recover via stealth.
      const reason = classifyAntibotError(err);
      try {
        result = await this.tryScrape(client, req.url, 'stealth');
        usedStealth = true;
      } catch (stealthErr) {
        const stealthReason = classifyAntibotError(stealthErr) ?? reason;
        throw new CrawlError(
          stealthReason ??
            `Firecrawl scrape failed for ${req.url}: ${(stealthErr as Error).message}`,
          stealthErr,
        );
      }
    }

    if (!result || result.success === false) {
      throw new CrawlError(
        `Firecrawl scrape unsuccessful for ${req.url}: ${result?.error ?? 'unknown error'}`,
      );
    }

    // ── Step 2: detect bot-trap on the basic response and retry stealth ──
    if (!usedStealth) {
      const data0 = result.data ?? result;
      const html0: string = data0.rawHtml ?? data0.html ?? '';
      if (isBotTrap(html0)) {
        try {
          const stealthResult = await this.tryScrape(client, req.url, 'stealth');
          if (stealthResult && stealthResult.success !== false) {
            const data1 = stealthResult.data ?? stealthResult;
            const html1: string = data1.rawHtml ?? data1.html ?? '';
            // Adopt stealth response only if it's actually better.
            if (html1.length > html0.length || !isBotTrap(html1)) {
              result = stealthResult;
              usedStealth = true;
            }
          }
        } catch (stealthErr) {
          throw new CrawlError(
            classifyAntibotError(stealthErr) ?? 'Site blocks crawlers (anti-bot protection)',
            stealthErr,
          );
        }
      }

      // ── Step 3: if STILL a bot-trap, fail explicitly. ──────────────────
      // Without this we'd silently store linkFound=false and the user would
      // wrongly conclude the link is missing.
      const dataFinal = result.data ?? result;
      const htmlFinal: string = dataFinal.rawHtml ?? dataFinal.html ?? '';
      if (isBotTrap(htmlFinal)) {
        throw new CrawlError(
          'Site returned a bot-trap page (no anchors in tiny HTML response)',
        );
      }
    }

    // ── Normalize the response into our CrawlResponse shape ──────────────
    const data = result.data ?? result;
    const metadata = data.metadata ?? {};
    const html: string = data.rawHtml ?? data.html ?? '';
    const finalUrl: string = metadata.sourceURL ?? metadata.url ?? req.url;
    const statusCode: number =
      typeof metadata.statusCode === 'number' ? metadata.statusCode : 200;

    const headers: Record<string, string> = {};
    if (metadata.headers && typeof metadata.headers === 'object') {
      for (const [k, v] of Object.entries(metadata.headers)) {
        headers[k.toLowerCase()] = String(v);
      }
    }

    const redirectChain: string[] = Array.isArray(metadata.redirectChain)
      ? metadata.redirectChain
      : req.url === finalUrl
        ? [req.url]
        : [req.url, finalUrl];

    return { finalUrl, redirectChain, statusCode, headers, html };
  }
}
