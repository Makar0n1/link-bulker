import { Global, Module } from '@nestjs/common';
import { Queue } from 'bullmq';
import Redis from 'ioredis';
import { QUEUE_NAMES } from '@link-checker/shared';
import { loadEnv } from '../../config/env';

export const SINGLE_LINK_QUEUE = Symbol('SINGLE_LINK_QUEUE');
export const MANUAL_CHECK_QUEUE = Symbol('MANUAL_CHECK_QUEUE');
export const SHEETS_RUN_QUEUE = Symbol('SHEETS_RUN_QUEUE');
export const REDIS_CLIENT = Symbol('REDIS_CLIENT');

/**
 * BullMQ producer-side. The API only enqueues jobs; the worker process
 * consumes them. We also expose a shared Redis client used by:
 *   - lock checks (LockManager.isLocked) before starting a bulk check
 *   - the SSE stream module for pub/sub subscription
 *
 * Marked @Global so feature modules can inject without re-importing.
 *
 * Cleanup of these connections is intentionally NOT done via OnModuleDestroy.
 * Tests override the queue providers with stub queues (see test/helpers/app.ts)
 * so the real BullMQ Queue constructors never run inside vitest forks (BullMQ +
 * vitest fork pool causes native crashes). Production lifetime is the API
 * process lifetime; connections are reaped on process exit.
 */
@Global()
@Module({
  providers: [
    {
      provide: REDIS_CLIENT,
      useFactory: () => {
        const env = loadEnv();
        return new Redis(env.REDIS_URL, { maxRetriesPerRequest: null });
      },
    },
    {
      provide: SINGLE_LINK_QUEUE,
      useFactory: () => {
        const env = loadEnv();
        return new Queue(QUEUE_NAMES.SINGLE_LINK, {
          connection: { url: env.REDIS_URL },
        });
      },
    },
    {
      provide: MANUAL_CHECK_QUEUE,
      useFactory: () => {
        const env = loadEnv();
        return new Queue(QUEUE_NAMES.MANUAL_CHECK, {
          connection: { url: env.REDIS_URL },
        });
      },
    },
    {
      provide: SHEETS_RUN_QUEUE,
      useFactory: () => {
        const env = loadEnv();
        return new Queue(QUEUE_NAMES.SHEETS_RUN, {
          connection: { url: env.REDIS_URL },
        });
      },
    },
  ],
  exports: [SINGLE_LINK_QUEUE, MANUAL_CHECK_QUEUE, SHEETS_RUN_QUEUE, REDIS_CLIENT],
})
export class QueueClientModule {}
