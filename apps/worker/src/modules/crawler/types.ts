import type { LinkOccurrence } from '@link-checker/shared';

/**
 * Result returned by CrawlerService.crawlAndAnalyze().
 *
 * Phase 3 will write this directly into the Link table; field names mirror
 * the schema for that reason. Keep them in sync.
 */
export interface CrawlAndAnalyzeResult {
  ok: boolean;
  // Donor facts (populated when ok=true OR partially when crawl succeeded but parsing failed)
  donorStatusCode: number | null;
  donorFinalUrl: string | null;
  donorRedirectChain: string[] | null;
  donorIndexable: boolean | null;
  donorMetaRobots: string | null;
  donorXRobotsTag: string | null;
  donorCanonical: string | null;
  canonicalMatches: boolean | null;

  // Acceptor matches
  linkFound: boolean | null;
  occurrences: LinkOccurrence[] | null;
  occurrencesCount: number;

  // Run metadata
  error: string | null;
  durationMs: number;
}
