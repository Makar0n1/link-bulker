import { Global, Module } from '@nestjs/common';
import { CrawlerModule } from '../crawler/crawler.module';
import { LinkRepository } from './link.repository';
import { ProgressPublisher } from './progress.publisher';
import { SingleLinkProcessor } from './single-link.processor';

/**
 * Shared singletons used by both QueueModule (manual-check, single-link)
 * and SheetsModule (sheets-task). Marked @Global so feature modules can
 * inject without re-importing — and so we get exactly ONE instance of
 * LinkRepository (and its PrismaClient) per worker process.
 *
 * Without this module, both QueueModule and SheetsModule would each
 * register their own LinkRepository provider and end up with two
 * separate Prisma connection pools.
 */
@Global()
@Module({
  imports: [CrawlerModule.forRoot()],
  providers: [LinkRepository, ProgressPublisher, SingleLinkProcessor],
  exports: [LinkRepository, ProgressPublisher, SingleLinkProcessor, CrawlerModule],
})
export class WorkerSharedModule {}
