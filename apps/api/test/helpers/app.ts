import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { Test } from '@nestjs/testing';
import { FastifyAdapter, type NestFastifyApplication } from '@nestjs/platform-fastify';
import fastifyCookie from '@fastify/cookie';
import bcrypt from 'bcryptjs';
import { AppModule } from '../../src/app.module';
import { AllExceptionsFilter } from '../../src/common/filters/all-exceptions.filter';
import { PrismaService } from '../../src/modules/prisma/prisma.service';
import {
  MANUAL_CHECK_QUEUE,
  SHEETS_RUN_QUEUE,
  SINGLE_LINK_QUEUE,
} from '../../src/modules/queue-client/queue-client.module';
import { loadEnv } from '../../src/config/env';

/**
 * Lightweight in-memory replacement for a BullMQ Queue used by API tests.
 *
 * Why we don't use real BullMQ here:
 *   - BullMQ Queue eagerly opens a Redis connection that doesn't play well
 *     with vitest's forked worker pool (the fork crashes with a native abort).
 *   - API tests only need to assert that .add() was called with the right
 *     payload. Real job processing is covered by worker tests.
 */
class StubQueue {
  public readonly added: Array<{ name: string; data: unknown; opts?: unknown }> = [];
  public readonly schedulers = new Map<string, { pattern: string; data: unknown }>();
  async add(name: string, data: unknown, opts?: unknown) {
    const id = `stub-${Math.random().toString(36).slice(2, 10)}`;
    this.added.push({ name, data, opts });
    return { id };
  }
  // BullMQ v5 scheduler API used by SheetsTasksService.upsertSchedule
  async upsertJobScheduler(
    schedulerId: string,
    when: { pattern: string },
    payload: { name: string; data: unknown },
  ) {
    this.schedulers.set(schedulerId, { pattern: when.pattern, data: payload.data });
  }
  async removeJobScheduler(schedulerId: string) {
    this.schedulers.delete(schedulerId);
  }
  async close() {
    /* no-op */
  }
}

export interface TestApp {
  app: NestFastifyApplication;
  prisma: PrismaService;
  singleLinkQueue: StubQueue;
  manualCheckQueue: StubQueue;
  sheetsRunQueue: StubQueue;
  close: () => Promise<void>;
}

/**
 * Boot a NestJS Fastify app in-process for tests.
 *
 * The queue-client providers are overridden with StubQueue instances so
 * tests don't open real BullMQ connections. The real Postgres and Redis
 * (for project locks via LockManager) are still used.
 */
export async function createTestApp(): Promise<TestApp> {
  const env = loadEnv();
  const singleLinkQueue = new StubQueue();
  const manualCheckQueue = new StubQueue();
  const sheetsRunQueue = new StubQueue();

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(SINGLE_LINK_QUEUE)
    .useValue(singleLinkQueue)
    .overrideProvider(MANUAL_CHECK_QUEUE)
    .useValue(manualCheckQueue)
    .overrideProvider(SHEETS_RUN_QUEUE)
    .useValue(sheetsRunQueue)
    .compile();

  const app = moduleRef.createNestApplication<NestFastifyApplication>(
    new FastifyAdapter({ logger: false }),
    { logger: false },
  );

  await app.register(fastifyCookie as any, { secret: env.AUTH_SECRET });
  app.setGlobalPrefix('api/v1');
  app.useGlobalFilters(new AllExceptionsFilter());

  await app.init();
  await app.getHttpAdapter().getInstance().ready();

  const prisma = app.get(PrismaService);

  return {
    app,
    prisma,
    singleLinkQueue,
    manualCheckQueue,
    sheetsRunQueue,
    close: async () => {
      await app.close();
    },
  };
}

/**
 * Clean all data tables. Order matters due to FK constraints.
 * AuditLog -> Link -> SheetsTask -> Project -> User
 */
export async function resetDb(prisma: PrismaService): Promise<void> {
  await prisma.$executeRawUnsafe(
    'TRUNCATE TABLE "AuditLog", "Link", "SheetsTask", "Project", "User" RESTART IDENTITY CASCADE',
  );
}

export interface SeededUser {
  id: string;
  email: string;
  password: string;
}

/**
 * Create an admin user with a known password for tests.
 */
export async function seedAdmin(
  prisma: PrismaService,
  email = 'test-admin@example.com',
  password = 'test-password-1234',
): Promise<SeededUser> {
  const passwordHash = bcrypt.hashSync(password, 4); // low cost = fast tests
  const user = await prisma.user.create({
    data: { email, passwordHash, role: 'ADMIN' },
  });
  return { id: user.id, email: user.email, password };
}
