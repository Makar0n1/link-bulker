import { Inject, Injectable, Logger } from '@nestjs/common';
import { parseDonorHtml, type CrawlerProvider, CrawlError } from '@link-checker/crawler-core';
import { extractAcceptorHost, safeHost } from '@link-checker/shared';
import {
  CircuitBreaker,
  DomainRateLimiter,
  RedisSemaphore,
} from '@link-checker/worker-core';
import type { CrawlAndAnalyzeResult } from './types';

export const CRAWLER_PROVIDER = Symbol('CRAWLER_PROVIDER');
export const FIRECRAWL_SEMAPHORE = Symbol('FIRECRAWL_SEMAPHORE');
export const DOMAIN_RATE_LIMITER = Symbol('DOMAIN_RATE_LIMITER');
export const CIRCUIT_BREAKER = Symbol('CIRCUIT_BREAKER');

@Injectable()
export class CrawlerService {
  private readonly logger = new Logger(CrawlerService.name);

  constructor(
    @Inject(CRAWLER_PROVIDER) private readonly provider: CrawlerProvider,
    @Inject(FIRECRAWL_SEMAPHORE) private readonly semaphore: RedisSemaphore,
    @Inject(DOMAIN_RATE_LIMITER) private readonly rateLimiter: DomainRateLimiter,
    @Inject(CIRCUIT_BREAKER) private readonly breaker: CircuitBreaker,
  ) {}

  /**
   * Crawl a donor URL and find all links pointing to acceptorHost.
   *
   * Concurrency contract:
   *   1. acquire per-host token (blocks if 2 RPS already used for this host)
   *   2. acquire global Firecrawl semaphore slot (blocks if all 45 in use)
   *   3. call provider through circuit breaker
   *   4. parse HTML
   *   5. release semaphore (always, even on errors)
   *
   * Never throws. Errors are returned as ok=false with `error` populated;
   * Phase 3 stores them as Link.status = ERROR.
   */
  async crawlAndAnalyze(donorUrl: string, acceptorRaw: string): Promise<CrawlAndAnalyzeResult> {
    const startedAt = Date.now();
    const result = baseResult();

    let donorHost: string | null;
    let acceptorHost: string;

    try {
      acceptorHost = extractAcceptorHost(acceptorRaw);
    } catch (err) {
      return { ...result, error: `Invalid acceptor: ${(err as Error).message}`, durationMs: Date.now() - startedAt };
    }

    donorHost = safeHost(donorUrl);
    if (!donorHost) {
      return { ...result, error: `Invalid donor URL: ${donorUrl}`, durationMs: Date.now() - startedAt };
    }

    // 1. Per-host rate limit (2 RPS by default)
    try {
      await this.rateLimiter.consume(donorHost);
    } catch (err) {
      return { ...result, error: `Rate limit wait failed: ${(err as Error).message}`, durationMs: Date.now() - startedAt };
    }

    // 2. Global concurrency slot
    const lease = await this.semaphore.acquire(60_000).catch((err) => {
      this.logger.warn(`Semaphore acquire failed: ${(err as Error).message}`);
      return null;
    });
    if (!lease) {
      return { ...result, error: 'Could not acquire crawler slot', durationMs: Date.now() - startedAt };
    }

    try {
      // 3. Call provider through circuit breaker
      const response = await this.breaker.exec(() => this.provider.scrape({ url: donorUrl }));

      // 4. Parse HTML and search for acceptor
      try {
        const parsed = parseDonorHtml({
          html: response.html,
          finalUrl: response.finalUrl,
          responseHeaders: response.headers,
          acceptorHost,
        });

        return {
          ok: true,
          donorStatusCode: response.statusCode,
          donorFinalUrl: response.finalUrl,
          donorRedirectChain: response.redirectChain,
          donorIndexable: parsed.indexable,
          donorMetaRobots: parsed.metaRobots,
          donorXRobotsTag: parsed.xRobotsTag,
          donorCanonical: parsed.canonical,
          canonicalMatches: parsed.canonicalMatches,
          linkFound: parsed.occurrences.length > 0,
          occurrences: parsed.occurrences,
          occurrencesCount: parsed.occurrences.length,
          error: null,
          durationMs: Date.now() - startedAt,
        };
      } catch (err) {
        // Crawl succeeded but parsing failed — surface what we have
        return {
          ...result,
          donorStatusCode: response.statusCode,
          donorFinalUrl: response.finalUrl,
          donorRedirectChain: response.redirectChain,
          error: `Parse error: ${(err as Error).message}`,
          durationMs: Date.now() - startedAt,
        };
      }
    } catch (err) {
      const message =
        err instanceof CrawlError
          ? err.message
          : err instanceof Error
            ? err.message
            : String(err);
      return { ...result, error: message, durationMs: Date.now() - startedAt };
    } finally {
      await lease.release().catch((err) => {
        this.logger.error(`Semaphore release failed: ${(err as Error).message}`);
      });
    }
  }
}

function baseResult(): CrawlAndAnalyzeResult {
  return {
    ok: false,
    donorStatusCode: null,
    donorFinalUrl: null,
    donorRedirectChain: null,
    donorIndexable: null,
    donorMetaRobots: null,
    donorXRobotsTag: null,
    donorCanonical: null,
    canonicalMatches: null,
    linkFound: null,
    occurrences: null,
    occurrencesCount: 0,
    error: null,
    durationMs: 0,
  };
}
