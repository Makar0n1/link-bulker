import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { DomainRateLimiter } from '../src/domain-rate-limiter';
import { flushPrefix, makeRedis, sleep, uniquePrefix } from './helpers';

const redis = makeRedis();

afterAll(async () => {
  await redis.quit();
});

describe('DomainRateLimiter', () => {
  let prefix: string;

  beforeEach(async () => {
    prefix = uniquePrefix('rl');
    await flushPrefix(redis, prefix);
  });

  it('allows initial burst up to capacity, then waits', async () => {
    const limiter = new DomainRateLimiter(redis, {
      ratePerSec: 2,
      capacity: 2,
      keyPrefix: prefix,
    });

    // Two immediate consumes should succeed (capacity = 2)
    expect(await limiter.tryConsume('example.com')).toBe(0);
    expect(await limiter.tryConsume('example.com')).toBe(0);

    // Third should ask us to wait
    const wait = await limiter.tryConsume('example.com');
    expect(wait).toBeGreaterThan(0);
    expect(wait).toBeLessThanOrEqual(600); // ~500ms expected at 2 RPS
  });

  it('separate hosts do not block each other', async () => {
    const limiter = new DomainRateLimiter(redis, {
      ratePerSec: 1,
      capacity: 1,
      keyPrefix: prefix,
    });

    expect(await limiter.tryConsume('a.com')).toBe(0);
    expect(await limiter.tryConsume('b.com')).toBe(0);
    expect(await limiter.tryConsume('c.com')).toBe(0);
  });

  it('10 sequential consumes at 2 RPS take ~5 seconds', async () => {
    const limiter = new DomainRateLimiter(redis, {
      ratePerSec: 2,
      capacity: 2,
      keyPrefix: prefix,
    });

    const host = 'studibucht.de';
    const start = Date.now();
    for (let i = 0; i < 10; i++) {
      await limiter.consume(host, 30_000);
    }
    const elapsed = Date.now() - start;

    // First 2 are instant (capacity), remaining 8 cost ~500ms each = ~4s.
    // Total ~4–5s with some scheduling jitter.
    expect(elapsed).toBeGreaterThanOrEqual(3500);
    expect(elapsed).toBeLessThanOrEqual(6500);
  });

  it('parallel consumes for the same host serialize via wait', async () => {
    const limiter = new DomainRateLimiter(redis, {
      ratePerSec: 5,
      capacity: 1,
      keyPrefix: prefix,
    });

    const host = 'busy.example';
    const start = Date.now();
    await Promise.all(Array.from({ length: 5 }, () => limiter.consume(host, 30_000)));
    const elapsed = Date.now() - start;

    // 1 free, 4 cost ~200ms each = ~800ms minimum at 5 RPS
    expect(elapsed).toBeGreaterThanOrEqual(600);
  });

  it('consume() throws on timeout', async () => {
    const limiter = new DomainRateLimiter(redis, {
      ratePerSec: 1,
      capacity: 1,
      keyPrefix: prefix,
    });
    await limiter.consume('slow.example');
    await expect(limiter.consume('slow.example', 100)).rejects.toThrow(/timeout/);
  });
});
