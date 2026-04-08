import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { SheetsTaskRunJobData } from '@link-checker/shared';
import { SheetsTaskService } from './sheets-task.service';

/**
 * BullMQ consumer entry point for queue:sheets-run.
 *
 * Each job represents one execution of a SheetsTask. The actual orchestration
 * lives in SheetsTaskService.run() so it can also be invoked directly from
 * tests without spinning up a real BullMQ worker.
 */
@Injectable()
export class SheetsTaskProcessor {
  private readonly logger = new Logger(SheetsTaskProcessor.name);

  constructor(private readonly service: SheetsTaskService) {}

  async handle(job: Job<SheetsTaskRunJobData>): Promise<void> {
    this.logger.log(`Sheets job ${job.id} for task ${job.data.sheetsTaskId}`);
    await this.service.run(job.data.sheetsTaskId);
  }
}
