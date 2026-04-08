import {
  ConflictException,
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  CreateManualLinksInput,
  LIMITS,
  ListLinksQuery,
  REDIS_KEYS,
  extractAcceptorHost,
  type ManualCheckJobData,
  type SingleLinkJobData,
} from '@link-checker/shared';
import { LockManager } from '@link-checker/worker-core';
import type { Link } from '@link-checker/db';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import {
  MANUAL_CHECK_QUEUE,
  REDIS_CLIENT,
  SINGLE_LINK_QUEUE,
} from '../queue-client/queue-client.module';

@Injectable()
export class LinksService {
  private readonly locks: LockManager;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) redis: Redis,
    @Inject(SINGLE_LINK_QUEUE) private readonly singleLinkQueue: Queue<SingleLinkJobData>,
    @Inject(MANUAL_CHECK_QUEUE) private readonly manualCheckQueue: Queue<ManualCheckJobData>,
  ) {
    this.locks = new LockManager(redis);
  }

  /** Verify project ownership and return its id, or throw 404. */
  private async assertProject(userId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
  }

  async list(
    userId: string,
    projectId: string,
    query: ListLinksQuery,
  ): Promise<{ items: Link[]; total: number; page: number; limit: number }> {
    await this.assertProject(userId, projectId);
    const where: any = { projectId };
    if (query.source) where.source = query.source.toUpperCase();
    if (query.status) where.status = query.status;

    const [items, total] = await Promise.all([
      this.prisma.link.findMany({
        where,
        orderBy: { createdAt: 'asc' },
        skip: (query.page - 1) * query.limit,
        take: query.limit,
      }),
      this.prisma.link.count({ where }),
    ]);
    return { items, total, page: query.page, limit: query.limit };
  }

  async createManualLinks(
    userId: string,
    projectId: string,
    dto: CreateManualLinksInput,
  ) {
    await this.assertProject(userId, projectId);

    if (dto.items.length > LIMITS.MAX_MANUAL_URLS_PER_TASK) {
      throw new HttpException(
        `Cannot add more than ${LIMITS.MAX_MANUAL_URLS_PER_TASK} links per request`,
        HttpStatus.BAD_REQUEST,
      );
    }

    // Pre-validate every acceptor by normalizing it. We surface invalid
    // entries with their index so the UI can highlight bad rows.
    const records: Array<{
      donorUrl: string;
      acceptorRaw: string;
      acceptorHost: string;
    }> = [];
    const errors: Array<{ index: number; message: string }> = [];

    dto.items.forEach((item, idx) => {
      try {
        const host = extractAcceptorHost(item.acceptor);
        records.push({
          donorUrl: item.donorUrl,
          acceptorRaw: item.acceptor,
          acceptorHost: host,
        });
      } catch (err) {
        errors.push({ index: idx, message: (err as Error).message });
      }
    });

    if (errors.length > 0) {
      throw new HttpException(
        { message: 'Some items have invalid acceptors', errors },
        HttpStatus.BAD_REQUEST,
      );
    }

    const result = await this.prisma.link.createMany({
      data: records.map((r) => ({
        projectId,
        source: 'MANUAL' as const,
        donorUrl: r.donorUrl,
        acceptorRaw: r.acceptorRaw,
        acceptorHost: r.acceptorHost,
      })),
    });

    return { created: result.count };
  }

  async deleteOne(userId: string, linkId: string) {
    const link = await this.prisma.link.findUnique({
      where: { id: linkId },
      select: { id: true, project: { select: { userId: true } } },
    });
    if (!link) throw new NotFoundException('Link not found');
    if (link.project.userId !== userId) throw new NotFoundException('Link not found');
    await this.prisma.link.delete({ where: { id: linkId } });
    return { ok: true as const };
  }

  async deleteAllManual(userId: string, projectId: string) {
    await this.assertProject(userId, projectId);
    const result = await this.prisma.link.deleteMany({
      where: { projectId, source: 'MANUAL' },
    });
    return { deleted: result.count };
  }

  /**
   * Start a bulk manual check.
   *
   * Steps:
   *   1. Verify project ownership.
   *   2. Snapshot all manual links in PENDING/ERROR state for this project.
   *   3. Check the Redis lock; if held, return 409 (the worker holds the
   *      lock for the entire duration of a previous run).
   *   4. Enqueue ManualCheckJob with the snapshotted IDs.
   *
   * The worker will acquire the lock; we don't acquire it here. This avoids
   * a race where API holds the lock but worker hasn't picked up the job yet.
   */
  async startManualCheck(userId: string, projectId: string) {
    await this.assertProject(userId, projectId);

    const lockKey = REDIS_KEYS.projectManualLock(projectId);
    if (await this.locks.isLocked(lockKey)) {
      throw new ConflictException('A manual check is already running for this project');
    }

    const links = await this.prisma.link.findMany({
      where: {
        projectId,
        source: 'MANUAL',
        status: { in: ['PENDING', 'ERROR'] },
      },
      select: { id: true },
    });

    if (links.length === 0) {
      throw new HttpException(
        'No links to check (only PENDING and ERROR links are eligible)',
        HttpStatus.BAD_REQUEST,
      );
    }

    const job = await this.manualCheckQueue.add(
      'manual-check',
      { projectId, linkIds: links.map((l) => l.id) },
      { removeOnComplete: 100, removeOnFail: 100 },
    );

    return { jobId: job.id, queued: links.length };
  }

  /**
   * Recheck a single link with atomic cooldown enforcement.
   *
   * The cooldown is enforced via a conditional updateMany rather than
   * read-then-write, so 100 concurrent requests result in exactly one
   * acquire and 99 rejections. Without this CAS, all concurrent requests
   * would read lastCooldownAt=null at the same time and slip through.
   */
  async recheckOne(userId: string, linkId: string) {
    const link = await this.prisma.link.findUnique({
      where: { id: linkId },
      select: {
        id: true,
        projectId: true,
        source: true,
        project: { select: { userId: true } },
      },
    });
    if (!link || link.project.userId !== userId) {
      throw new NotFoundException('Link not found');
    }

    if (link.source === 'MANUAL') {
      const lockKey = REDIS_KEYS.projectManualLock(link.projectId);
      if (await this.locks.isLocked(lockKey)) {
        throw new ConflictException('A manual check is currently running for this project');
      }
    }

    const cooldownMs = LIMITS.SINGLE_LINK_RECHECK_COOLDOWN_SEC * 1000;
    const cutoff = new Date(Date.now() - cooldownMs);

    // Atomic compare-and-set: only one concurrent request will affect a row.
    const acquired = await this.prisma.link.updateMany({
      where: {
        id: linkId,
        OR: [{ lastCooldownAt: null }, { lastCooldownAt: { lt: cutoff } }],
      },
      data: { lastCooldownAt: new Date() },
    });

    if (acquired.count === 0) {
      const fresh = await this.prisma.link.findUnique({
        where: { id: linkId },
        select: { lastCooldownAt: true },
      });
      const elapsed = fresh?.lastCooldownAt
        ? Date.now() - fresh.lastCooldownAt.getTime()
        : 0;
      const retryAfterSec = Math.max(1, Math.ceil((cooldownMs - elapsed) / 1000));
      throw new HttpException(
        { message: 'Recheck cooldown active', retryAfterSec },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const job = await this.singleLinkQueue.add(
      'single-link',
      { linkId, projectId: link.projectId, source: link.source },
      { removeOnComplete: 100, removeOnFail: 100 },
    );

    return { jobId: job.id };
  }
}
