import { Inject, Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import { LockManager, type Lock } from '@link-checker/worker-core';
import { REDIS_KEYS, type ManualCheckJobData } from '@link-checker/shared';
import { LinkRepository } from './link.repository';
import { ProgressPublisher } from './progress.publisher';
import { SingleLinkProcessor } from './single-link.processor';

// How many links to process in parallel within a single manual-check run.
// The global Firecrawl semaphore (45 slots) is the real ceiling.
const INTERNAL_CONCURRENCY = 15;
const HEARTBEAT_INTERVAL_MS = 10_000;
const PROJECT_LOCK_TTL_MS = 30 * 60 * 1000;

/**
 * Processes a manual bulk check for a project.
 *
 * Lifecycle:
 *   1. Acquire Redis lock lock:project:{id}:manual. If already held → fail
 *      fast (this is the "another check is already running" case).
 *   2. Mark Project.manualChecking=true (DB mirror for UI).
 *   3. Publish lock_changed=true.
 *   4. Mark all link IDs QUEUED.
 *   5. Process links in chunks of INTERNAL_CONCURRENCY in parallel.
 *   6. After each chunk, publish a throttled progress event.
 *   7. Heartbeat the Redis lock every 10s on a separate timer so the lock
 *      doesn't expire mid-job.
 *   8. Always release the lock + flip DB flag in finally.
 *
 * Why we don't use BullMQ Flow Producer here: it would require persisting
 * one job per link in Redis, blowing up memory for 1000-link batches. The
 * single-process loop with internal concurrency is simpler, uses our existing
 * Crawler semaphore for global concurrency, and lets us hold the project
 * lock for the entire duration.
 */
@Injectable()
export class ManualCheckProcessor {
  private readonly logger = new Logger(ManualCheckProcessor.name);
  private readonly locks: LockManager;

  constructor(
    @Inject('WORKER_REDIS') redis: any,
    private readonly links: LinkRepository,
    private readonly publisher: ProgressPublisher,
    private readonly singleLink: SingleLinkProcessor,
  ) {
    this.locks = new LockManager(redis);
  }

  async handle(job: Job<ManualCheckJobData>): Promise<void> {
    const { projectId, linkIds } = job.data;
    const lockKey = REDIS_KEYS.projectManualLock(projectId);

    const lock = await this.locks.acquire(lockKey, { ttlMs: PROJECT_LOCK_TTL_MS });
    if (!lock) {
      this.logger.warn(`Project ${projectId} already locked, skipping job ${job.id}`);
      return;
    }

    const heartbeat = this.startHeartbeat(lock);

    try {
      await this.links.setProjectManualChecking(projectId, true);
      await this.publisher.publishNow({
        type: 'lock_changed',
        projectId,
        manualChecking: true,
      });

      // Mark all targeted links as QUEUED in one statement
      await this.links.markManyStatus(linkIds, 'QUEUED');

      // Process in chunks. Each chunk has INTERNAL_CONCURRENCY parallel
      // single-link calls. The global Firecrawl semaphore enforces the
      // cluster-wide cap of 45.
      let processed = 0;
      const total = linkIds.length;

      for (let i = 0; i < total; i += INTERNAL_CONCURRENCY) {
        const slice = linkIds.slice(i, i + INTERNAL_CONCURRENCY);
        await Promise.all(slice.map((id) => this.singleLink.processOne(id)));
        processed += slice.length;

        const counts = await this.links.getProgressCounts(linkIds);
        await this.publisher.publish({
          type: 'progress',
          projectId,
          total,
          processed: counts.processed,
          found: counts.found,
          errors: counts.errors,
        });

        // BullMQ progress for the dashboard / stalled detection
        await job.updateProgress(Math.round((processed / total) * 100));
      }

      const final = await this.links.getProgressCounts(linkIds);
      await this.publisher.publishNow({
        type: 'done',
        projectId,
        total,
        found: final.found,
        errors: final.errors,
      });
    } finally {
      clearInterval(heartbeat);
      await this.links.setProjectManualChecking(projectId, false).catch((err) => {
        this.logger.error(`Failed to clear manualChecking flag: ${(err as Error).message}`);
      });
      await this.publisher.publishNow({
        type: 'lock_changed',
        projectId,
        manualChecking: false,
      });
      await lock.release().catch((err) => {
        this.logger.error(`Failed to release project lock: ${(err as Error).message}`);
      });
    }
  }

  private startHeartbeat(lock: Lock): NodeJS.Timeout {
    return setInterval(async () => {
      try {
        const ok = await lock.heartbeat();
        if (!ok) {
          this.logger.error(
            `Lock heartbeat returned false for ${lock.key}; another holder may have taken over`,
          );
        }
      } catch (err) {
        this.logger.error(`Lock heartbeat error: ${(err as Error).message}`);
      }
    }, HEARTBEAT_INTERVAL_MS);
  }
}
