import { Inject, Injectable, Logger } from '@nestjs/common';
import type Redis from 'ioredis';
import { LIMITS, REDIS_KEYS, type ProgressEvent } from '@link-checker/shared';

/**
 * Publishes progress events to Redis pub/sub for the API's SSE endpoint.
 *
 * Throttling: per-project, at most one "progress" event per SSE_THROTTLE_MS
 * window. "link_updated", "lock_changed", and "done" events bypass throttling
 * because they are individually meaningful and infrequent enough.
 */
@Injectable()
export class ProgressPublisher {
  private readonly logger = new Logger(ProgressPublisher.name);
  private readonly progressThrottle = new Map<string, number>();

  constructor(@Inject('WORKER_REDIS') private readonly redis: Redis) {}

  async publish(event: ProgressEvent): Promise<void> {
    if (event.type === 'progress') {
      const last = this.progressThrottle.get(event.projectId) ?? 0;
      const now = Date.now();
      if (now - last < LIMITS.SSE_THROTTLE_MS) return;
      this.progressThrottle.set(event.projectId, now);
    }

    const channel = REDIS_KEYS.projectChannel(event.projectId);
    try {
      await this.redis.publish(channel, JSON.stringify(event));
    } catch (err) {
      this.logger.error(`publish failed for ${channel}: ${(err as Error).message}`);
    }
  }

  /** Force-publish without throttling. Used for terminal "done" events. */
  async publishNow(event: ProgressEvent): Promise<void> {
    const channel = REDIS_KEYS.projectChannel(event.projectId);
    try {
      await this.redis.publish(channel, JSON.stringify(event));
    } catch (err) {
      this.logger.error(`publishNow failed for ${channel}: ${(err as Error).message}`);
    }
  }
}
