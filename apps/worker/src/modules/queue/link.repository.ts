import { Injectable, OnModuleDestroy, OnModuleInit, Logger } from '@nestjs/common';
import {
  PrismaClient,
  type Link,
  type LinkStatus,
  type SheetsTask,
  type SheetsTaskStatus,
} from '@link-checker/db';
import type { CrawlAndAnalyzeResult } from '../crawler/types';

/**
 * Persistence boundary between worker processors and the Link table.
 *
 * Owns its own PrismaClient instance because the worker is a standalone Nest
 * context with no global PrismaModule. The API has a separate PrismaService.
 */
@Injectable()
export class LinkRepository implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(LinkRepository.name);
  private readonly prisma = new PrismaClient({
    log: process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'],
  });

  async onModuleInit() {
    await this.prisma.$connect();
  }

  async onModuleDestroy() {
    await this.prisma.$disconnect();
  }

  async findById(id: string): Promise<Link | null> {
    return this.prisma.link.findUnique({ where: { id } });
  }

  async markStatus(id: string, status: LinkStatus): Promise<void> {
    await this.prisma.link.update({ where: { id }, data: { status } });
  }

  async markManyStatus(ids: string[], status: LinkStatus): Promise<void> {
    if (ids.length === 0) return;
    await this.prisma.link.updateMany({ where: { id: { in: ids } }, data: { status } });
  }

  /**
   * Persist a CrawlAndAnalyzeResult to a single link. Used by both
   * single-link and manual-check processors.
   */
  async saveResult(linkId: string, result: CrawlAndAnalyzeResult): Promise<Link> {
    const status: LinkStatus = result.ok ? 'DONE' : 'ERROR';
    return this.prisma.link.update({
      where: { id: linkId },
      data: {
        status,
        donorStatusCode: result.donorStatusCode,
        donorFinalUrl: result.donorFinalUrl,
        donorRedirectChain: (result.donorRedirectChain ?? undefined) as object | undefined,
        donorIndexable: result.donorIndexable,
        donorMetaRobots: result.donorMetaRobots,
        donorXRobotsTag: result.donorXRobotsTag,
        donorCanonical: result.donorCanonical,
        canonicalMatches: result.canonicalMatches,
        linkFound: result.linkFound,
        occurrences: (result.occurrences ?? undefined) as object | undefined,
        occurrencesCount: result.occurrencesCount,
        error: result.error,
        checkDurationMs: result.durationMs,
        lastCheckedAt: new Date(),
      },
    });
  }

  /**
   * Set lastCooldownAt for cooldown enforcement on single-link rechecks.
   */
  async touchCooldown(linkId: string): Promise<void> {
    await this.prisma.link.update({
      where: { id: linkId },
      data: { lastCooldownAt: new Date() },
    });
  }

  /**
   * Set the project's manualChecking flag. Mirrors the Redis lock for the UI.
   */
  async setProjectManualChecking(projectId: string, value: boolean): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: { manualChecking: value },
    });
  }

  /**
   * Aggregate counts for a manual-check job's progress publication.
   */
  async getProgressCounts(linkIds: string[]) {
    if (linkIds.length === 0) {
      return { total: 0, processed: 0, found: 0, errors: 0 };
    }
    const [done, error, found] = await Promise.all([
      this.prisma.link.count({ where: { id: { in: linkIds }, status: 'DONE' } }),
      this.prisma.link.count({ where: { id: { in: linkIds }, status: 'ERROR' } }),
      this.prisma.link.count({ where: { id: { in: linkIds }, linkFound: true } }),
    ]);
    return { total: linkIds.length, processed: done + error, found, errors: error };
  }

  // ───────────────────────────────────────────────────────────────────
  // Sheets-task helpers
  // ───────────────────────────────────────────────────────────────────

  async findSheetsTaskById(id: string): Promise<SheetsTask | null> {
    return this.prisma.sheetsTask.findUnique({ where: { id } });
  }

  async setSheetsTaskStatus(
    id: string,
    status: SheetsTaskStatus,
    lastRunStatus: string | null,
  ): Promise<void> {
    const data: any = { status };
    if (status === 'RUNNING') {
      data.isChecking = true;
    } else if (status === 'COMPLETED' || status === 'FAILED') {
      data.isChecking = false;
      data.lastRunAt = new Date();
      data.lastRunStatus = lastRunStatus;
    }
    await this.prisma.sheetsTask.update({ where: { id }, data });
  }

  async setProjectSheetsChecking(projectId: string, value: boolean): Promise<void> {
    await this.prisma.project.update({
      where: { id: projectId },
      data: { sheetsChecking: value },
    });
  }

  /**
   * Replace every Link belonging to this sheets task with the supplied
   * fresh batch. Done in a transaction so the project never sees a half-
   * deleted state. Order is preserved by createMany insertion order.
   */
  async replaceSheetsLinks(
    sheetsTaskId: string,
    projectId: string,
    rows: Array<{ donorUrl: string; acceptorRaw: string; acceptorHost: string }>,
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      await tx.link.deleteMany({ where: { sheetsTaskId } });
      if (rows.length > 0) {
        await tx.link.createMany({
          data: rows.map((r) => ({
            projectId,
            sheetsTaskId,
            source: 'SHEETS' as const,
            donorUrl: r.donorUrl,
            acceptorRaw: r.acceptorRaw,
            acceptorHost: r.acceptorHost,
          })),
        });
      }
    });
  }

  /** Fetch all links for a sheets task ordered by their createdAt asc. */
  async findLinksBySheetsTaskOrdered(sheetsTaskId: string): Promise<Link[]> {
    return this.prisma.link.findMany({
      where: { sheetsTaskId },
      orderBy: [{ createdAt: 'asc' }, { id: 'asc' }],
    });
  }

  async getSheetsProgressCounts(sheetsTaskId: string) {
    const [total, done, error, found] = await Promise.all([
      this.prisma.link.count({ where: { sheetsTaskId } }),
      this.prisma.link.count({ where: { sheetsTaskId, status: 'DONE' } }),
      this.prisma.link.count({ where: { sheetsTaskId, status: 'ERROR' } }),
      this.prisma.link.count({ where: { sheetsTaskId, linkFound: true } }),
    ]);
    return { total, processed: done + error, found, errors: error };
  }
}
