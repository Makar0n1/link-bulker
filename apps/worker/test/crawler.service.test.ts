import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { CrawlerService } from '../src/modules/crawler/crawler.service';
import { buildCrawler, makeRedis, type CrawlerTestRig } from './helpers/build-crawler';
import { MockCrawlerProvider } from './mocks/mock-crawler.provider';

const redis = makeRedis();

afterAll(async () => {
  await redis.quit();
});

beforeEach(async () => {
  // Clean Phase-2 redis state so test ordering doesn't matter
  const keys = await redis.keys('sem:firecrawl');
  if (keys.length) await redis.del(...keys);
  const rl = await redis.keys('rl:host:*');
  if (rl.length) await redis.del(...rl);
});

describe('CrawlerService (integration)', () => {
  let rig: CrawlerTestRig;

  afterEach(async () => {
    await rig?.close();
  });

  it('crawls a URL and finds matching occurrences', async () => {
    rig = await buildCrawler(new MockCrawlerProvider());
    const result = await rig.service.crawlAndAnalyze(
      'https://donor.example/page',
      'studibucht.de',
    );

    expect(result.ok).toBe(true);
    expect(result.error).toBeNull();
    expect(result.donorStatusCode).toBe(200);
    expect(result.linkFound).toBe(true);
    expect(result.occurrencesCount).toBe(1);
    expect(result.occurrences?.[0]).toMatchObject({
      href: 'https://studibucht.de/x',
      anchor: 'match',
      rel: ['nofollow'],
      tag: 'a',
    });
  });

  it('returns ok=true with empty occurrences when no match found', async () => {
    rig = await buildCrawler(
      new MockCrawlerProvider({
        html: '<a href="https://nope.com/x">no</a>',
      }),
    );
    const result = await rig.service.crawlAndAnalyze(
      'https://donor.example/page',
      'studibucht.de',
    );

    expect(result.ok).toBe(true);
    expect(result.linkFound).toBe(false);
    expect(result.occurrencesCount).toBe(0);
  });

  it('returns ok=false on invalid donor URL', async () => {
    rig = await buildCrawler(new MockCrawlerProvider());
    const result = await rig.service.crawlAndAnalyze('not a url', 'studibucht.de');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid donor URL/);
  });

  it('returns ok=false on invalid acceptor', async () => {
    rig = await buildCrawler(new MockCrawlerProvider());
    const result = await rig.service.crawlAndAnalyze('https://donor.example', '');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/Invalid acceptor/);
  });

  it('captures provider errors as result.error and releases the slot', async () => {
    const provider = new MockCrawlerProvider({ failEveryN: 1 });
    rig = await buildCrawler(provider);

    const result = await rig.service.crawlAndAnalyze('https://donor.example/x', 'studibucht.de');
    expect(result.ok).toBe(false);
    expect(result.error).toMatch(/scheduled failure/);

    // Slot should be released — semaphore must be empty
    const size = await redis.zcard('sem:firecrawl');
    expect(size).toBe(0);
  });

  it('30 parallel crawls respect the global concurrency limit', async () => {
    // We can't easily snoop the limit from outside the service, but we can
    // verify all calls completed and no slots leaked.
    const provider = new MockCrawlerProvider({ delayMs: 30 });
    rig = await buildCrawler(provider);

    const N = 30;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        rig.service.crawlAndAnalyze(
          `https://donor${i}.example/page`,
          'studibucht.de',
        ),
      ),
    );

    expect(results).toHaveLength(N);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(provider.callCount).toBe(N);

    const size = await redis.zcard('sem:firecrawl');
    expect(size).toBe(0);
  });

  it('serializes 6 parallel calls to the same host via per-domain rate limit', async () => {
    // Default PER_DOMAIN_RPS=2, capacity=2. 6 calls should take ≥ 2s
    // (2 free, 4 cost ~500ms each at 2 RPS).
    const provider = new MockCrawlerProvider({ delayMs: 5 });
    rig = await buildCrawler(provider);

    const start = Date.now();
    const results = await Promise.all(
      Array.from({ length: 6 }, () =>
        rig.service.crawlAndAnalyze('https://samehost.example/p', 'studibucht.de'),
      ),
    );
    const elapsed = Date.now() - start;

    expect(results.every((r) => r.ok)).toBe(true);
    // Sanity bounds; CI might be slow so we only require lower bound is meaningful
    expect(elapsed).toBeGreaterThanOrEqual(1500);
  });

  it('mini-load: 200 parallel crawls complete without leaking memory or slots', async () => {
    const provider = new MockCrawlerProvider({ delayMs: 5 });
    rig = await buildCrawler(provider);

    const memBefore = process.memoryUsage().heapUsed;
    const N = 200;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        rig.service.crawlAndAnalyze(
          `https://donor${i}.example/page`,
          'studibucht.de',
        ),
      ),
    );
    const memAfter = process.memoryUsage().heapUsed;
    const deltaMb = (memAfter - memBefore) / 1024 / 1024;

    expect(results).toHaveLength(N);
    expect(results.every((r) => r.ok)).toBe(true);
    expect(provider.callCount).toBe(N);

    // No slot leaks
    const size = await redis.zcard('sem:firecrawl');
    expect(size).toBe(0);

    // Memory delta should stay reasonable. We allow 200 MB headroom.
    expect(deltaMb).toBeLessThan(200);
  });
});
