import { Module } from '@nestjs/common';
import { SheetsClientService } from './sheets-client.service';
import { SheetsTaskService } from './sheets-task.service';
import { SheetsTaskProcessor } from './sheets-task.processor';

/**
 * Sheets module composes the Google Sheets client + orchestrator + BullMQ
 * processor. It depends on WorkerSharedModule (registered globally in
 * AppModule) for LinkRepository, ProgressPublisher, SingleLinkProcessor
 * and the WORKER_REDIS connection.
 */
@Module({
  providers: [SheetsClientService, SheetsTaskService, SheetsTaskProcessor],
  exports: [SheetsTaskService, SheetsTaskProcessor, SheetsClientService],
})
export class SheetsModule {}
