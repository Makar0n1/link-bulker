import type Redis from 'ioredis';
import { randomUUID } from 'node:crypto';

/**
 * Project-level mutex on Redis.
 *
 * Used in Phase 3 by the API to ensure only one bulk check runs per project
 * per source (manual / sheets) at a time. Acquire returns null if locked,
 * otherwise a Lock object with heartbeat/release.
 *
 * Implementation:
 *   - SET key token NX PX ttl
 *   - heartbeat: Lua check-and-extend (PEXPIRE only if value matches token)
 *   - release: Lua check-and-del
 *
 * Heartbeat is mandatory for long jobs: TTL is short (30s default) so a
 * crashed holder doesn't block the project for hours. The owning worker
 * extends every ~10s.
 */

const HEARTBEAT_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('PEXPIRE', KEYS[1], ARGV[2])
else
  return 0
end
`;

const RELEASE_LUA = `
if redis.call('GET', KEYS[1]) == ARGV[1] then
  return redis.call('DEL', KEYS[1])
else
  return 0
end
`;

export interface LockOptions {
  /** Lock TTL in ms. Default 30_000 (30 seconds). */
  ttlMs?: number;
}

export interface Lock {
  readonly key: string;
  readonly token: string;
  heartbeat(): Promise<boolean>;
  release(): Promise<boolean>;
}

export class LockManager {
  constructor(private readonly redis: Redis) {}

  /**
   * Try to acquire a lock. Returns null if already held.
   */
  async acquire(key: string, options: LockOptions = {}): Promise<Lock | null> {
    const ttlMs = options.ttlMs ?? 30_000;
    const token = randomUUID();
    const result = await this.redis.set(key, token, 'PX', ttlMs, 'NX');
    if (result !== 'OK') return null;
    return this.makeLock(key, token, ttlMs);
  }

  /**
   * Returns true if the key currently holds a lock (regardless of who owns it).
   */
  async isLocked(key: string): Promise<boolean> {
    const exists = await this.redis.exists(key);
    return exists === 1;
  }

  private makeLock(key: string, token: string, ttlMs: number): Lock {
    return {
      key,
      token,
      heartbeat: async () => {
        const r = (await this.redis.eval(HEARTBEAT_LUA, 1, key, token, ttlMs.toString())) as number;
        return r === 1;
      },
      release: async () => {
        const r = (await this.redis.eval(RELEASE_LUA, 1, key, token)) as number;
        return r === 1;
      },
    };
  }
}
