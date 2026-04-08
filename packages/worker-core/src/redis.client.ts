import Redis, { type RedisOptions } from 'ioredis';

/**
 * Thin factory for ioredis. We do NOT singleton at the module level because
 * tests want isolated clients with their own lifecycles. Long-running services
 * should hold one instance per process.
 */
export function createRedisClient(url: string, options: RedisOptions = {}): Redis {
  return new Redis(url, {
    maxRetriesPerRequest: null, // BullMQ requires null; safe default everywhere
    enableReadyCheck: true,
    ...options,
  });
}
