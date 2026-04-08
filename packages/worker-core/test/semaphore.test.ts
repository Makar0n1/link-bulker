import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { RedisSemaphore } from '../src/semaphore';
import { flushPrefix, makeRedis, sleep, uniquePrefix } from './helpers';

const redis = makeRedis();

afterAll(async () => {
  await redis.quit();
});

describe('RedisSemaphore', () => {
  let key: string;

  beforeEach(async () => {
    key = `${uniquePrefix('sem')}`;
    await flushPrefix(redis, key);
  });

  it('allows up to "limit" concurrent holders', async () => {
    const sem = new RedisSemaphore(redis, { key, limit: 3, ttlMs: 5000 });

    const a = await sem.tryAcquire();
    const b = await sem.tryAcquire();
    const c = await sem.tryAcquire();
    const d = await sem.tryAcquire();

    expect(a).not.toBeNull();
    expect(b).not.toBeNull();
    expect(c).not.toBeNull();
    expect(d).toBeNull();

    expect(await sem.size()).toBe(3);

    await a!.release();
    expect(await sem.size()).toBe(2);

    const e = await sem.tryAcquire();
    expect(e).not.toBeNull();
    expect(await sem.size()).toBe(3);
  });

  it('100 parallel acquire/release never exceeds the limit', async () => {
    const limit = 10;
    const sem = new RedisSemaphore(redis, { key, limit, ttlMs: 5000, pollIntervalMs: 5 });

    let active = 0;
    let peak = 0;

    const work = async () => {
      const lease = await sem.acquire(10_000);
      active += 1;
      if (active > peak) peak = active;
      await sleep(10);
      active -= 1;
      await lease.release();
    };

    await Promise.all(Array.from({ length: 100 }, () => work()));

    expect(peak).toBeLessThanOrEqual(limit);
    expect(peak).toBeGreaterThan(0);
    expect(await sem.size()).toBe(0);
  });

  it('reclaims slots from holders that died (TTL expiry)', async () => {
    const sem = new RedisSemaphore(redis, { key, limit: 2, ttlMs: 200 });

    const a = await sem.tryAcquire();
    const b = await sem.tryAcquire();
    expect(a).not.toBeNull();
    expect(b).not.toBeNull();

    // simulate dead holder: never call release. Just wait past TTL.
    await sleep(300);

    const c = await sem.tryAcquire();
    expect(c).not.toBeNull();
  });

  it('heartbeat extends an existing lease', async () => {
    const sem = new RedisSemaphore(redis, { key, limit: 1, ttlMs: 200 });
    const lease = await sem.tryAcquire();
    expect(lease).not.toBeNull();

    // Heartbeat several times within TTL window
    for (let i = 0; i < 5; i++) {
      await sleep(80);
      const ok = await lease!.heartbeat();
      expect(ok).toBe(true);
    }

    // Slot should still be held
    const stolen = await sem.tryAcquire();
    expect(stolen).toBeNull();

    await lease!.release();
  });

  it('acquire() throws on timeout', async () => {
    const sem = new RedisSemaphore(redis, { key, limit: 1, ttlMs: 10_000, pollIntervalMs: 10 });
    await sem.tryAcquire();
    await expect(sem.acquire(100)).rejects.toThrow(/timeout/);
  });
});
