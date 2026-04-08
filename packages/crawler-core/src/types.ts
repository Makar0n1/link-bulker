/**
 * Provider-agnostic crawler interface.
 *
 * The MVP only ships FirecrawlProvider, but everything that consumes the
 * crawler talks to this interface so we can add a Playwright fallback later
 * without touching workers.
 */

export interface CrawlRequest {
  url: string;
}

export interface CrawlResponse {
  /** Final URL after redirects (as reported by the provider). */
  finalUrl: string;
  /** Full HTTP redirect chain, including the initial URL. */
  redirectChain: string[];
  /** HTTP status of the final response. */
  statusCode: number;
  /** Lowercased response headers, may be partial depending on provider. */
  headers: Record<string, string>;
  /** Raw HTML of the final page (may be empty for non-HTML responses). */
  html: string;
}

export class CrawlError extends Error {
  public readonly reason?: unknown;
  constructor(message: string, reason?: unknown) {
    super(message);
    this.name = 'CrawlError';
    this.reason = reason;
  }
}

export interface CrawlerProvider {
  readonly name: string;
  scrape(req: CrawlRequest): Promise<CrawlResponse>;
}
