import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { LockManager } from '../src/lock-manager';
import { flushPrefix, makeRedis, sleep, uniquePrefix } from './helpers';

const redis = makeRedis();
const locks = new LockManager(redis);

afterAll(async () => {
  await redis.quit();
});

describe('LockManager', () => {
  let key: string;

  beforeEach(async () => {
    key = uniquePrefix('lock');
    await flushPrefix(redis, key);
  });

  it('acquires when free, refuses when held', async () => {
    const a = await locks.acquire(key, { ttlMs: 5000 });
    expect(a).not.toBeNull();
    expect(await locks.isLocked(key)).toBe(true);

    const b = await locks.acquire(key, { ttlMs: 5000 });
    expect(b).toBeNull();

    await a!.release();
    expect(await locks.isLocked(key)).toBe(false);

    const c = await locks.acquire(key, { ttlMs: 5000 });
    expect(c).not.toBeNull();
  });

  it('expires after TTL when not heartbeating', async () => {
    const a = await locks.acquire(key, { ttlMs: 200 });
    expect(a).not.toBeNull();
    await sleep(300);
    expect(await locks.isLocked(key)).toBe(false);
  });

  it('heartbeat extends an active lock', async () => {
    const a = await locks.acquire(key, { ttlMs: 200 });
    expect(a).not.toBeNull();

    for (let i = 0; i < 5; i++) {
      await sleep(80);
      const ok = await a!.heartbeat();
      expect(ok).toBe(true);
    }

    expect(await locks.isLocked(key)).toBe(true);
    await a!.release();
  });

  it('release only succeeds for the original token', async () => {
    const a = await locks.acquire(key, { ttlMs: 5000 });
    expect(a).not.toBeNull();

    // simulate another process trying to release a different token
    const fakeReleased = await redis.eval(
      `if redis.call('GET', KEYS[1]) == ARGV[1] then return redis.call('DEL', KEYS[1]) else return 0 end`,
      1,
      key,
      'wrong-token',
    );
    expect(fakeReleased).toBe(0);
    expect(await locks.isLocked(key)).toBe(true);

    const realReleased = await a!.release();
    expect(realReleased).toBe(true);
  });

  it('heartbeat fails after another holder takes over', async () => {
    const a = await locks.acquire(key, { ttlMs: 200 });
    expect(a).not.toBeNull();
    await sleep(300); // a expires
    const b = await locks.acquire(key, { ttlMs: 5000 });
    expect(b).not.toBeNull();

    // a's heartbeat must fail because token mismatch
    const ok = await a!.heartbeat();
    expect(ok).toBe(false);
  });
});
