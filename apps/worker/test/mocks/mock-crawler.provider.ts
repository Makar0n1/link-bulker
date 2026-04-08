import type { CrawlRequest, CrawlResponse, CrawlerProvider } from '@link-checker/crawler-core';

export interface MockBehavior {
  /** Per-request artificial delay (ms). Default 5. */
  delayMs?: number;
  /** Throw on every Nth call (1 = always, 0 = never). Default 0. */
  failEveryN?: number;
  /** Static HTML to return. Default has one matching link. */
  html?: string;
  /** Status code returned in CrawlResponse. Default 200. */
  statusCode?: number;
}

/**
 * Deterministic in-memory CrawlerProvider for tests.
 *
 * Why we mock at the provider boundary, not at the network layer:
 *   - Tests stay fast and offline
 *   - We don't burn the user's Firecrawl credits
 *   - Behavior knobs (delay, failure rate) are explicit
 */
export class MockCrawlerProvider implements CrawlerProvider {
  readonly name = 'mock';
  callCount = 0;

  constructor(private readonly behavior: MockBehavior = {}) {}

  async scrape(req: CrawlRequest): Promise<CrawlResponse> {
    this.callCount += 1;
    const delay = this.behavior.delayMs ?? 5;
    if (delay > 0) await new Promise((r) => setTimeout(r, delay));

    const failEvery = this.behavior.failEveryN ?? 0;
    if (failEvery > 0 && this.callCount % failEvery === 0) {
      throw new Error(`Mock provider scheduled failure on call #${this.callCount}`);
    }

    const html =
      this.behavior.html ??
      `<html><head><title>Donor</title></head><body>
        <a href="https://studibucht.de/x" rel="nofollow">match</a>
        <a href="https://other.com/y">no</a>
      </body></html>`;

    return {
      finalUrl: req.url,
      redirectChain: [req.url],
      statusCode: this.behavior.statusCode ?? 200,
      headers: {},
      html,
    };
  }
}
