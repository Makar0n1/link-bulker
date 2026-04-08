import type Redis from 'ioredis';

/**
 * Token bucket per Redis key. Designed for per-host rate limiting:
 *   "no more than N requests per second to a given donor host".
 *
 * Atomic in Lua: refill based on elapsed time, consume one token, persist.
 * Returns the number of milliseconds to wait before retrying:
 *   0   = consumed, proceed now
 *   >0  = wait this many ms then call consume() again
 *
 * Why a token bucket and not fixed window:
 *   - smooth rate enforcement (no thundering herd at window boundary)
 *   - bursting up to capacity is allowed
 *   - simple to reason about with Lua
 */

const CONSUME_LUA = `
local key = KEYS[1]
local capacity = tonumber(ARGV[1])
local refill_per_sec = tonumber(ARGV[2])
local now_ms = tonumber(ARGV[3])
local ttl_ms = tonumber(ARGV[4])

local data = redis.call('HMGET', key, 'tokens', 'ts')
local tokens = tonumber(data[1])
local ts = tonumber(data[2])

if tokens == nil then
  tokens = capacity
  ts = now_ms
end

local elapsed_sec = (now_ms - ts) / 1000.0
if elapsed_sec < 0 then elapsed_sec = 0 end
tokens = math.min(capacity, tokens + elapsed_sec * refill_per_sec)

local wait_ms = 0
if tokens >= 1 then
  tokens = tokens - 1
else
  local needed = 1 - tokens
  wait_ms = math.ceil((needed / refill_per_sec) * 1000)
end

redis.call('HMSET', key, 'tokens', tokens, 'ts', now_ms)
redis.call('PEXPIRE', key, ttl_ms)
return wait_ms
`;

export interface DomainRateLimiterOptions {
  /** Tokens per second (sustained rate). Default 2. */
  ratePerSec?: number;
  /** Bucket capacity (max burst). Default = ratePerSec. */
  capacity?: number;
  /** Key TTL after last update (ms). Default 5 minutes. */
  ttlMs?: number;
  /** Key prefix. Default "rl:host". */
  keyPrefix?: string;
}

export class DomainRateLimiter {
  private readonly ratePerSec: number;
  private readonly capacity: number;
  private readonly ttlMs: number;
  private readonly keyPrefix: string;

  constructor(
    private readonly redis: Redis,
    options: DomainRateLimiterOptions = {},
  ) {
    this.ratePerSec = options.ratePerSec ?? 2;
    this.capacity = options.capacity ?? this.ratePerSec;
    this.ttlMs = options.ttlMs ?? 5 * 60 * 1000;
    this.keyPrefix = options.keyPrefix ?? 'rl:host';
  }

  /**
   * Try to consume one token for a host.
   * Returns 0 if consumed (proceed), or ms to wait before retrying.
   */
  async tryConsume(host: string): Promise<number> {
    const result = (await this.redis.eval(
      CONSUME_LUA,
      1,
      `${this.keyPrefix}:${host}`,
      this.capacity.toString(),
      this.ratePerSec.toString(),
      Date.now().toString(),
      this.ttlMs.toString(),
    )) as number;
    return Number(result);
  }

  /**
   * Block until a token is available for a host. Polls with adaptive sleep
   * based on the limiter's own wait_ms response.
   */
  async consume(host: string, maxWaitMs = 60_000): Promise<void> {
    const deadline = Date.now() + maxWaitMs;
    while (true) {
      const wait = await this.tryConsume(host);
      if (wait <= 0) return;
      if (Date.now() + wait > deadline) {
        throw new Error(
          `DomainRateLimiter consume timeout for host "${host}" after ${maxWaitMs}ms`,
        );
      }
      await sleep(wait);
    }
  }
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}
