import Redis from 'ioredis';
import { randomUUID } from 'node:crypto';
import { createRedisClient } from '../src/redis.client';

/**
 * One Redis client per test file. Tests run sequentially (single-fork) so
 * key collision is bounded by the per-test prefix in keyFor().
 */
export function makeRedis(): Redis {
  const url = process.env.REDIS_URL ?? 'redis://localhost:6379';
  return createRedisClient(url, { lazyConnect: false });
}

/** Unique key prefix per test invocation, so tests never collide. */
export function uniquePrefix(name: string): string {
  return `test:${name}:${randomUUID().slice(0, 8)}`;
}

export async function flushPrefix(redis: Redis, prefix: string): Promise<void> {
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length > 0) await redis.del(...keys);
}

export function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
