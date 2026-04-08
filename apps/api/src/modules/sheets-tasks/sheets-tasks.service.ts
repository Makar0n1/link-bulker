import {
  ConflictException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Queue } from 'bullmq';
import {
  CreateSheetsTaskInput,
  REDIS_KEYS,
  UpdateSheetsTaskInput,
  type SheetsTaskRunJobData,
} from '@link-checker/shared';
import { LockManager } from '@link-checker/worker-core';
import type Redis from 'ioredis';
import { PrismaService } from '../prisma/prisma.service';
import {
  REDIS_CLIENT,
  SHEETS_RUN_QUEUE,
} from '../queue-client/queue-client.module';

/**
 * SheetsTask CRUD + run-now + cron schedule management.
 *
 * Cron strategy: when scheduleCron is set on create/update, the API
 * registers a BullMQ job scheduler with a deterministic id derived from
 * the task id. On delete (or scheduleCron removal), the scheduler is
 * removed. Worker processes the queue exactly the same as ad-hoc runs.
 *
 * Why API owns the scheduler instead of the worker: BullMQ schedulers are
 * cluster-wide state in Redis, and writing them from the API keeps the
 * "API is the source of truth" model — no boot reconciliation needed.
 */
@Injectable()
export class SheetsTasksService {
  private readonly locks: LockManager;

  constructor(
    private readonly prisma: PrismaService,
    @Inject(REDIS_CLIENT) redis: Redis,
    @Inject(SHEETS_RUN_QUEUE) private readonly queue: Queue<SheetsTaskRunJobData>,
  ) {
    this.locks = new LockManager(redis);
  }

  private async assertProject(userId: string, projectId: string): Promise<void> {
    const project = await this.prisma.project.findFirst({
      where: { id: projectId, userId },
      select: { id: true },
    });
    if (!project) throw new NotFoundException('Project not found');
  }

  private async findOwnedTask(userId: string, taskId: string) {
    const task = await this.prisma.sheetsTask.findUnique({
      where: { id: taskId },
      include: { project: { select: { userId: true } } },
    });
    if (!task || task.project.userId !== userId) {
      throw new NotFoundException('Sheets task not found');
    }
    return task;
  }

  // ─────────────────────────────────────────────────────────────────────
  // CRUD
  // ─────────────────────────────────────────────────────────────────────

  async list(userId: string, projectId: string) {
    await this.assertProject(userId, projectId);
    const tasks = await this.prisma.sheetsTask.findMany({
      where: { projectId },
      orderBy: { createdAt: 'desc' },
      include: { _count: { select: { links: true } } },
    });
    return tasks.map((t) => ({
      id: t.id,
      projectId: t.projectId,
      name: t.name,
      spreadsheetId: t.spreadsheetId,
      sheetGid: t.sheetGid,
      donorColumn: t.donorColumn,
      acceptorColumn: t.acceptorColumn,
      resultStartCol: t.resultStartCol,
      headerRow: t.headerRow,
      dataStartRow: t.dataStartRow,
      scheduleCron: t.scheduleCron,
      lastRunAt: t.lastRunAt,
      lastRunStatus: t.lastRunStatus,
      status: t.status,
      isChecking: t.isChecking,
      linksCount: t._count.links,
      createdAt: t.createdAt,
      updatedAt: t.updatedAt,
    }));
  }

  async create(userId: string, projectId: string, dto: CreateSheetsTaskInput) {
    await this.assertProject(userId, projectId);
    const task = await this.prisma.sheetsTask.create({
      data: {
        projectId,
        name: dto.name,
        spreadsheetId: dto.spreadsheetId,
        sheetGid: dto.sheetGid,
        donorColumn: dto.donorColumn,
        acceptorColumn: dto.acceptorColumn,
        resultStartCol: dto.resultStartCol,
        headerRow: dto.headerRow,
        dataStartRow: dto.dataStartRow,
        scheduleCron: dto.scheduleCron,
      },
    });
    if (dto.scheduleCron) {
      await this.upsertSchedule(task.id, dto.scheduleCron);
    }
    return task;
  }

  async update(userId: string, taskId: string, dto: UpdateSheetsTaskInput) {
    const existing = await this.findOwnedTask(userId, taskId);
    const next = await this.prisma.sheetsTask.update({
      where: { id: taskId },
      data: dto,
    });

    // Sync the cron scheduler if scheduleCron field was touched
    if (dto.scheduleCron !== undefined) {
      if (dto.scheduleCron) {
        await this.upsertSchedule(taskId, dto.scheduleCron);
      } else {
        await this.removeSchedule(taskId);
      }
    } else if (existing.scheduleCron && dto.donorColumn === undefined) {
      // No-op
    }

    return next;
  }

  async remove(userId: string, taskId: string) {
    await this.findOwnedTask(userId, taskId);
    await this.removeSchedule(taskId).catch(() => undefined);
    await this.prisma.sheetsTask.delete({ where: { id: taskId } });
    return { ok: true as const };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Run now
  // ─────────────────────────────────────────────────────────────────────

  async runNow(userId: string, taskId: string) {
    const task = await this.findOwnedTask(userId, taskId);

    const lockKey = REDIS_KEYS.projectSheetsLock(task.projectId);
    if (await this.locks.isLocked(lockKey)) {
      throw new ConflictException('A sheets task is already running for this project');
    }

    const job = await this.queue.add(
      'sheets-task-run',
      { sheetsTaskId: taskId },
      { removeOnComplete: 100, removeOnFail: 100 },
    );
    return { jobId: job.id };
  }

  // ─────────────────────────────────────────────────────────────────────
  // Cron scheduler
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Register or update a cron schedule for a sheets task.
   *
   * BullMQ v5 introduced upsertJobScheduler which supersedes the older
   * `repeat` option. We use it via `(queue as any)` to avoid pinning the
   * exact SDK version in our types.
   */
  private async upsertSchedule(taskId: string, cron: string): Promise<void> {
    const schedulerId = `sheets-task-${taskId}`;
    const q: any = this.queue;
    if (typeof q.upsertJobScheduler === 'function') {
      await q.upsertJobScheduler(
        schedulerId,
        { pattern: cron },
        {
          name: 'sheets-task-run',
          data: { sheetsTaskId: taskId, scheduled: true } as SheetsTaskRunJobData,
          opts: { removeOnComplete: 100, removeOnFail: 100 },
        },
      );
    } else {
      // Fallback for older BullMQ
      await this.queue.add(
        'sheets-task-run',
        { sheetsTaskId: taskId, scheduled: true },
        {
          repeat: { pattern: cron },
          jobId: schedulerId,
          removeOnComplete: 100,
          removeOnFail: 100,
        },
      );
    }
  }

  private async removeSchedule(taskId: string): Promise<void> {
    const schedulerId = `sheets-task-${taskId}`;
    const q: any = this.queue;
    if (typeof q.removeJobScheduler === 'function') {
      await q.removeJobScheduler(schedulerId).catch(() => undefined);
    } else {
      // Fallback: use removeRepeatableByKey via getRepeatableJobs
      try {
        const repeatables = await this.queue.getRepeatableJobs?.();
        const target = repeatables?.find((r: any) => r.id === schedulerId);
        if (target) {
          await (this.queue as any).removeRepeatableByKey(target.key);
        }
      } catch {
        /* best-effort */
      }
    }
  }

  // ─────────────────────────────────────────────────────────────────────
  // Misc
  // ─────────────────────────────────────────────────────────────────────

  /**
   * Service account email is read from env. Worker holds the file/JSON;
   * API only needs the email to display the "share with…" hint, so we
   * either get it from a dedicated env var or fall through to a clean error.
   */
  getServiceAccountEmail(): { email: string | null } {
    const email = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL ?? null;
    return { email };
  }
}
