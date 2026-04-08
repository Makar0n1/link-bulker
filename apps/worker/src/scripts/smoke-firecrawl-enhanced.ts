/**
 * Same as smoke-firecrawl.ts but with Firecrawl Enhanced Mode options.
 *
 * Costs 4 credits per page instead of 1, but waits for JavaScript to render
 * the page. Use this to test pages that fail with the basic /scrape mode
 * (SPA shells, lazy-loaded content, cookie walls).
 *
 * Usage:
 *   pnpm --filter @link-checker/worker exec node -r @swc-node/register \
 *     src/scripts/smoke-firecrawl-enhanced.ts <donorUrl> <acceptor>
 */
import 'reflect-metadata';
import { loadEnv } from '../config/env';

async function main() {
  const [donorUrl, acceptor] = process.argv.slice(2);
  if (!donorUrl || !acceptor) {
    console.error('Usage: smoke-firecrawl-enhanced.ts <donorUrl> <acceptor>');
    process.exit(1);
  }

  const env = loadEnv();
  if (!env.FIRECRAWL_API_KEY) {
    console.error('FIRECRAWL_API_KEY missing in env');
    process.exit(1);
  }

  console.log(`[smoke-enhanced] donor:    ${donorUrl}`);
  console.log(`[smoke-enhanced] acceptor: ${acceptor}\n`);

  const mod = await import('@mendable/firecrawl-js');
  const Ctor: any = (mod as any).default ?? (mod as any).FirecrawlApp;
  const client = new Ctor({ apiKey: env.FIRECRAWL_API_KEY });

  const startedAt = Date.now();
  const result = await client.scrapeUrl(donorUrl, {
    formats: ['rawHtml'],
    waitFor: 3000, // wait 3 seconds for JS to render
    timeout: 60000,
    onlyMainContent: false, // we want the full DOM, not main-content extraction
    blockAds: false,
    // Use stealth proxy: residential IPs + antibot bypass.
    // Costs more credits but defeats Cloudflare/DataDome challenges.
    proxy: 'stealth',
  });
  const elapsed = Date.now() - startedAt;

  console.log(`[smoke-enhanced] elapsed: ${elapsed}ms`);
  console.log(`[smoke-enhanced] success: ${result?.success}`);
  console.log(`[smoke-enhanced] proxyUsed: ${(result as any)?.data?.metadata?.proxyUsed ?? '?'}`);

  const data = result?.data ?? result;
  const html: string = data?.rawHtml ?? data?.html ?? '';
  const status = data?.metadata?.statusCode;

  console.log(`[smoke-enhanced] statusCode: ${status}`);
  console.log(`[smoke-enhanced] html length: ${html.length} bytes`);

  const aHrefCount = (html.match(/<a\s+[^>]*href/gi) || []).length;
  const acceptorEsc = acceptor.replace(/[.]/g, '\\.');
  const acceptorMentions = (html.match(new RegExp(acceptorEsc, 'gi')) || []).length;
  console.log(`[smoke-enhanced] <a href> count:        ${aHrefCount}`);
  console.log(`[smoke-enhanced] acceptor mentions:     ${acceptorMentions}`);

  // Find the first 3 anchor tags that contain the acceptor host
  const anchorRegex = new RegExp(
    `<a\\s+[^>]*href\\s*=\\s*["'][^"']*${acceptorEsc}[^"']*["'][^>]*>[^<]*</a>`,
    'gi',
  );
  const anchorMatches = html.match(anchorRegex) || [];
  console.log(`[smoke-enhanced] <a href> with acceptor: ${anchorMatches.length}`);
  for (const m of anchorMatches.slice(0, 5)) {
    console.log(`  ${m.slice(0, 200)}`);
  }

  process.exit(0);
}

main().catch((err) => {
  console.error('[smoke-enhanced] crashed:', err);
  process.exit(1);
});
