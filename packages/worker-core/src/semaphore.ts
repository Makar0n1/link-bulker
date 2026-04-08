import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

/**
 * Distributed counting semaphore on Redis.
 *
 * Implementation: a sorted set whose score is the acquisition timestamp (ms).
 * Each holder has a unique token. On acquire we prune entries older than TTL
 * (auto-recovery from crashed holders) and check ZCARD < limit.
 *
 * Why sorted set + TTL instead of plain counter:
 *   - If a worker crashes between INCR and DECR, a counter would leak forever.
 *   - With per-entry timestamps + ZREMRANGEBYSCORE we self-heal after TTL.
 *
 * Acquire blocks by polling. Pass a maxWaitMs to bound the wait, otherwise
 * it polls indefinitely (tests use small bounds).
 */

const ACQUIRE_LUA = `
local key = KEYS[1]
local now = tonumber(ARGV[1])
local ttl = tonumber(ARGV[2])
local limit = tonumber(ARGV[3])
local token = ARGV[4]

-- prune entries older than ttl (self-healing on dead holders)
redis.call('ZREMRANGEBYSCORE', key, '-inf', now - ttl)

local count = redis.call('ZCARD', key)
if count < limit then
  redis.call('ZADD', key, now, token)
  redis.call('PEXPIRE', key, ttl)
  return 1
end
return 0
`;

const RELEASE_LUA = `
local key = KEYS[1]
local token = ARGV[1]
return redis.call('ZREM', key, token)
`;

const HEARTBEAT_LUA = `
local key = KEYS[1]
local token = ARGV[1]
local now = tonumber(ARGV[2])
local ttl = tonumber(ARGV[3])
if redis.call('ZSCORE', key, token) then
  redis.call('ZADD', key, now, token)
  redis.call('PEXPIRE', key, ttl)
  return 1
end
return 0
`;

export interface SemaphoreOptions {
  /** Redis key, e.g. "sem:firecrawl" */
  key: string;
  /** Max concurrent holders */
  limit: number;
  /** Holder TTL (ms). If a holder doesn't release or heartbeat in this time,
   *  its slot is reclaimed. Default: 60_000. */
  ttlMs?: number;
  /** Polling interval when waiting for a slot (ms). Default: 50. */
  pollIntervalMs?: number;
}

export interface SemaphoreLease {
  release(): Promise<void>;
  heartbeat(): Promise<boolean>;
  readonly token: string;
}

export class RedisSemaphore {
  private readonly ttlMs: number;
  private readonly pollIntervalMs: number;

  constructor(
    private readonly redis: Redis,
    private readonly options: SemaphoreOptions,
  ) {
    this.ttlMs = options.ttlMs ?? 60_000;
    this.pollIntervalMs = options.pollIntervalMs ?? 50;
  }

  /**
   * Try to acquire a slot once. Returns a lease or null.
   */
  async tryAcquire(): Promise<SemaphoreLease | null> {
    const token = randomUUID();
    const result = (await this.redis.eval(
      ACQUIRE_LUA,
      1,
      this.options.key,
      Date.now().toString(),
      this.ttlMs.toString(),
      this.options.limit.toString(),
      token,
    )) as number;

    if (result !== 1) return null;
    return this.makeLease(token);
  }

  /**
   * Block until a slot is acquired or until maxWaitMs elapses.
   * Throws on timeout.
   */
  async acquire(maxWaitMs = 30_000): Promise<SemaphoreLease> {
    const deadline = Date.now() + maxWaitMs;
    while (true) {
      const lease = await this.tryAcquire();
      if (lease) return lease;
      if (Date.now() >= deadline) {
        throw new Error(`Semaphore "${this.options.key}" acquire timeout after ${maxWaitMs}ms`);
      }
      await sleep(this.pollIntervalMs);
    }
  }

  async size(): Promise<number> {
    return this.redis.zcard(this.options.key);
  }

  private makeLease(token: string): SemaphoreLease {
    return {
      token,
      release: async () => {
        await this.redis.eval(RELEASE_LUA, 1, this.options.key, token);
      },
      heartbeat: async () => {
        const result = (await this.redis.eval(
          HEARTBEAT_LUA,
          1,
          this.options.key,
          token,
          Date.now().toString(),
          this.ttlMs.toString(),
        )) as number;
        return result === 1;
      },
    };
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
