import { Module } from '@nestjs/common';
import { WorkerSharedModule } from './modules/queue/worker-shared.module';
import { QueueModule } from './modules/queue/queue.module';

/**
 * Root module of the worker process.
 *
 * - WorkerSharedModule (global) provides LinkRepository, ProgressPublisher,
 *   SingleLinkProcessor and the CrawlerModule. Both QueueModule and
 *   SheetsModule consume them via DI without re-importing.
 * - QueueModule registers the BullMQ workers and imports SheetsModule.
 */
@Module({
  imports: [WorkerSharedModule, QueueModule],
})
export class AppModule {}
