import { Injectable, Logger } from '@nestjs/common';
import type { Job } from 'bullmq';
import type { SingleLinkJobData } from '@link-checker/shared';
import { CrawlerService } from '../crawler/crawler.service';
import { LinkRepository } from './link.repository';
import { ProgressPublisher } from './progress.publisher';

/**
 * Processes a single Link end-to-end:
 *   PENDING|ERROR -> CHECKING -> crawl -> save -> DONE|ERROR -> SSE
 *
 * Used both for one-off rechecks (queue:single-link) and as the inner unit
 * inside manual-check.processor. The function is exported separately so the
 * batch processor can call it without going through BullMQ.
 */
@Injectable()
export class SingleLinkProcessor {
  private readonly logger = new Logger(SingleLinkProcessor.name);

  constructor(
    private readonly crawler: CrawlerService,
    private readonly links: LinkRepository,
    private readonly publisher: ProgressPublisher,
  ) {}

  /** BullMQ Worker entry point. */
  async handle(job: Job<SingleLinkJobData>): Promise<void> {
    const { linkId } = job.data;
    await this.processOne(linkId);
  }

  /**
   * Crawl one link and persist the result. Safe to call directly from
   * manual-check processor; never throws.
   */
  async processOne(linkId: string): Promise<void> {
    const link = await this.links.findById(linkId);
    if (!link) {
      this.logger.warn(`Link ${linkId} not found, skipping`);
      return;
    }

    await this.links.markStatus(linkId, 'CHECKING');
    await this.publisher.publishNow({
      type: 'link_updated',
      linkId,
      projectId: link.projectId,
      status: 'CHECKING',
      linkFound: null,
      occurrencesCount: 0,
      donorStatusCode: null,
      error: null,
      lastCheckedAt: null,
    });

    const result = await this.crawler.crawlAndAnalyze(link.donorUrl, link.acceptorRaw);
    const saved = await this.links.saveResult(linkId, result);

    await this.publisher.publishNow({
      type: 'link_updated',
      linkId,
      projectId: link.projectId,
      status: saved.status,
      linkFound: saved.linkFound,
      occurrencesCount: saved.occurrencesCount,
      donorStatusCode: saved.donorStatusCode,
      error: saved.error,
      lastCheckedAt: saved.lastCheckedAt?.toISOString() ?? null,
    });
  }
}
