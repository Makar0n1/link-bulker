import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import Redis from 'ioredis';
import { REDIS_KEYS } from '@link-checker/shared';
import { createTestApp, resetDb, seedAdmin, type TestApp } from './helpers/app';

const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', {
  maxRetriesPerRequest: null,
});

async function authedCookie(
  request: ReturnType<typeof supertest>,
  email: string,
  password: string,
): Promise<string[]> {
  const res = await request.post('/api/v1/auth/login').send({ email, password });
  return res.headers['set-cookie'] as unknown as string[];
}

async function clearLocks() {
  const lockKeys = await redis.keys('lock:project:*');
  if (lockKeys.length) await redis.del(...lockKeys);
}

describe('Sheets tasks (integration)', () => {
  let ctx: TestApp;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    ctx = await createTestApp();
    request = supertest(ctx.app.getHttpServer());
  });

  afterAll(async () => {
    await ctx.close();
    await clearLocks();
    await redis.quit();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
    await clearLocks();
    ctx.sheetsRunQueue.added.length = 0;
    ctx.sheetsRunQueue.schedulers.clear();
  });

  async function setupProject() {
    const admin = await seedAdmin(ctx.prisma);
    const cookie = await authedCookie(request, admin.email, admin.password);
    const project = await ctx.prisma.project.create({
      data: { userId: admin.id, name: 'Test' },
    });
    return { admin, cookie, project };
  }

  const baseTask = {
    name: 'My sheet',
    spreadsheetId: '1abc',
    sheetGid: 0,
    donorColumn: 'A',
    acceptorColumn: 'B',
    resultStartCol: 'C',
    headerRow: 1,
    dataStartRow: 2,
  };

  describe('POST /projects/:id/sheets-tasks', () => {
    it('creates a sheets task without cron', async () => {
      const { cookie, project } = await setupProject();
      const res = await request
        .post(`/api/v1/projects/${project.id}/sheets-tasks`)
        .set('Cookie', cookie)
        .send(baseTask);
      expect(res.status).toBe(201);
      expect(res.body).toMatchObject({ name: 'My sheet', spreadsheetId: '1abc' });
      expect(ctx.sheetsRunQueue.schedulers.size).toBe(0);
    });

    it('registers a cron scheduler when scheduleCron is provided', async () => {
      const { cookie, project } = await setupProject();
      const res = await request
        .post(`/api/v1/projects/${project.id}/sheets-tasks`)
        .set('Cookie', cookie)
        .send({ ...baseTask, scheduleCron: '0 * * * *' });
      expect(res.status).toBe(201);
      expect(ctx.sheetsRunQueue.schedulers.size).toBe(1);
      const [first] = Array.from(ctx.sheetsRunQueue.schedulers.values());
      expect(first?.pattern).toBe('0 * * * *');
    });

    it('rejects invalid column letter', async () => {
      const { cookie, project } = await setupProject();
      const res = await request
        .post(`/api/v1/projects/${project.id}/sheets-tasks`)
        .set('Cookie', cookie)
        .send({ ...baseTask, donorColumn: 'a1' });
      expect(res.status).toBe(400);
    });

    it('rejects without auth', async () => {
      const project = await ctx.prisma.project.create({
        data: {
          name: 'X',
          user: {
            create: {
              email: `noauth-sheets-${Date.now()}@x.com`,
              passwordHash: 'h',
              role: 'ADMIN',
            },
          },
        },
      });
      const res = await request
        .post(`/api/v1/projects/${project.id}/sheets-tasks`)
        .send(baseTask);
      expect(res.status).toBe(401);
    });
  });

  describe('GET /projects/:id/sheets-tasks', () => {
    it('lists tasks for the project', async () => {
      const { cookie, project } = await setupProject();
      await request
        .post(`/api/v1/projects/${project.id}/sheets-tasks`)
        .set('Cookie', cookie)
        .send(baseTask);
      await request
        .post(`/api/v1/projects/${project.id}/sheets-tasks`)
        .set('Cookie', cookie)
        .send({ ...baseTask, name: 'Second' });
      const list = await request
        .get(`/api/v1/projects/${project.id}/sheets-tasks`)
        .set('Cookie', cookie);
      expect(list.status).toBe(200);
      expect(list.body).toHaveLength(2);
    });
  });

  describe('PATCH /sheets-tasks/:id', () => {
    it('updates fields and registers cron when added', async () => {
      const { cookie, project } = await setupProject();
      const create = await request
        .post(`/api/v1/projects/${project.id}/sheets-tasks`)
        .set('Cookie', cookie)
        .send(baseTask);
      const id = create.body.id;
      const patch = await request
        .patch(`/api/v1/sheets-tasks/${id}`)
        .set('Cookie', cookie)
        .send({ name: 'Renamed', scheduleCron: '*/5 * * * *' });
      expect(patch.status).toBe(200);
      expect(patch.body.name).toBe('Renamed');
      expect(ctx.sheetsRunQueue.schedulers.size).toBe(1);
    });

    it('removes cron scheduler when scheduleCron is set to empty string', async () => {
      const { cookie, project } = await setupProject();
      const create = await request
        .post(`/api/v1/projects/${project.id}/sheets-tasks`)
        .set('Cookie', cookie)
        .send({ ...baseTask, scheduleCron: '0 * * * *' });
      expect(ctx.sheetsRunQueue.schedulers.size).toBe(1);
      // Sending empty string should clear the cron
      await request
        .patch(`/api/v1/sheets-tasks/${create.body.id}`)
        .set('Cookie', cookie)
        .send({ scheduleCron: '' });
      // Empty string is falsy → removeSchedule path
      expect(ctx.sheetsRunQueue.schedulers.size).toBe(0);
    });
  });

  describe('DELETE /sheets-tasks/:id', () => {
    it('deletes the task and removes its cron scheduler', async () => {
      const { cookie, project } = await setupProject();
      const create = await request
        .post(`/api/v1/projects/${project.id}/sheets-tasks`)
        .set('Cookie', cookie)
        .send({ ...baseTask, scheduleCron: '0 * * * *' });
      expect(ctx.sheetsRunQueue.schedulers.size).toBe(1);
      const del = await request
        .delete(`/api/v1/sheets-tasks/${create.body.id}`)
        .set('Cookie', cookie);
      expect(del.status).toBe(200);
      expect(ctx.sheetsRunQueue.schedulers.size).toBe(0);
    });

    it("cannot delete another user's task", async () => {
      const { cookie } = await setupProject();
      const otherAdmin = await seedAdmin(ctx.prisma, 'other-sheets@test.com');
      const otherProject = await ctx.prisma.project.create({
        data: { userId: otherAdmin.id, name: 'Other' },
      });
      const otherTask = await ctx.prisma.sheetsTask.create({
        data: {
          projectId: otherProject.id,
          ...baseTask,
        },
      });
      const res = await request
        .delete(`/api/v1/sheets-tasks/${otherTask.id}`)
        .set('Cookie', cookie);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /sheets-tasks/:id/run', () => {
    it('enqueues a sheets-run job and returns its id', async () => {
      const { cookie, project } = await setupProject();
      const create = await request
        .post(`/api/v1/projects/${project.id}/sheets-tasks`)
        .set('Cookie', cookie)
        .send(baseTask);
      const res = await request
        .post(`/api/v1/sheets-tasks/${create.body.id}/run`)
        .set('Cookie', cookie);
      expect(res.status).toBe(201);
      expect(res.body.jobId).toBeDefined();
      expect(ctx.sheetsRunQueue.added).toHaveLength(1);
      expect(ctx.sheetsRunQueue.added[0]?.data).toMatchObject({
        sheetsTaskId: create.body.id,
      });
    });

    it('returns 409 when project sheets lock is held', async () => {
      const { cookie, project } = await setupProject();
      const create = await request
        .post(`/api/v1/projects/${project.id}/sheets-tasks`)
        .set('Cookie', cookie)
        .send(baseTask);
      // Manually hold the project sheets lock
      const lockKey = REDIS_KEYS.projectSheetsLock(project.id);
      await redis.set(lockKey, 'someone', 'PX', 30_000);

      const res = await request
        .post(`/api/v1/sheets-tasks/${create.body.id}/run`)
        .set('Cookie', cookie);
      expect(res.status).toBe(409);
    });
  });
});
