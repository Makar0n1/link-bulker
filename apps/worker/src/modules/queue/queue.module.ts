import { Module, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import { Worker, type Job } from 'bullmq';
import {
  QUEUE_NAMES,
  type ManualCheckJobData,
  type SheetsTaskRunJobData,
  type SingleLinkJobData,
} from '@link-checker/shared';
import { SheetsModule } from '../sheets/sheets.module';
import { SheetsTaskProcessor } from '../sheets/sheets-task.processor';
import { SingleLinkProcessor } from './single-link.processor';
import { ManualCheckProcessor } from './manual-check.processor';
import { loadEnv } from '../../config/env';

/**
 * Queue module: registers BullMQ Workers for the manual-check, single-link
 * and sheets-run queues, wiring them to NestJS-managed processors via DI.
 *
 * Why separate Worker instances per queue: BullMQ workers are 1:1 with
 * queues. We use BullMQ directly instead of @nestjs/bullmq to avoid an
 * extra dependency layer; the integration is small enough to inline.
 */
@Module({
  // SingleLinkProcessor / LinkRepository / ProgressPublisher come from
  // WorkerSharedModule (registered globally in AppModule).
  imports: [SheetsModule],
  providers: [ManualCheckProcessor],
  exports: [ManualCheckProcessor],
})
export class QueueModule implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(QueueModule.name);
  private workers: Worker[] = [];

  constructor(
    private readonly singleLink: SingleLinkProcessor,
    private readonly manualCheck: ManualCheckProcessor,
    private readonly sheetsTask: SheetsTaskProcessor,
  ) {}

  onModuleInit(): void {
    // Skip BullMQ workers in tests so processors can be invoked directly
    // without polluting Redis with worker connections.
    if (process.env.WORKER_DISABLE_BULLMQ === '1') {
      this.logger.log('BullMQ workers disabled via WORKER_DISABLE_BULLMQ=1');
      return;
    }

    const env = loadEnv();
    const connection = { url: env.REDIS_URL };

    const singleLinkWorker = new Worker<SingleLinkJobData>(
      QUEUE_NAMES.SINGLE_LINK,
      async (job: Job<SingleLinkJobData>) => this.singleLink.handle(job),
      {
        connection,
        concurrency: 5,
        lockDuration: 120_000,
      },
    );
    singleLinkWorker.on('failed', (job, err) => {
      this.logger.error(`single-link job ${job?.id} failed: ${err.message}`);
    });

    const manualCheckWorker = new Worker<ManualCheckJobData>(
      QUEUE_NAMES.MANUAL_CHECK,
      async (job: Job<ManualCheckJobData>) => this.manualCheck.handle(job),
      {
        connection,
        // One bulk job per worker process at a time. Multiple worker replicas
        // give cross-project parallelism; a single project's job is sequential.
        concurrency: 1,
        lockDuration: 5 * 60_000,
      },
    );
    manualCheckWorker.on('failed', (job, err) => {
      this.logger.error(`manual-check job ${job?.id} failed: ${err.message}`);
    });

    const sheetsTaskWorker = new Worker<SheetsTaskRunJobData>(
      QUEUE_NAMES.SHEETS_RUN,
      async (job: Job<SheetsTaskRunJobData>) => this.sheetsTask.handle(job),
      {
        connection,
        // Same rationale as manual-check: one sheets task per worker at a
        // time, parallelism comes from worker replicas.
        concurrency: 1,
        lockDuration: 10 * 60_000,
      },
    );
    sheetsTaskWorker.on('failed', (job, err) => {
      this.logger.error(`sheets-run job ${job?.id} failed: ${err.message}`);
    });

    this.workers = [singleLinkWorker, manualCheckWorker, sheetsTaskWorker];
    this.logger.log(`BullMQ workers started: ${this.workers.map((w) => w.name).join(', ')}`);
  }

  async onModuleDestroy(): Promise<void> {
    await Promise.all(this.workers.map((w) => w.close()));
    this.workers = [];
  }
}
