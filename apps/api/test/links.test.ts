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

describe('Links (integration)', () => {
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
  });

  async function setupProject() {
    const admin = await seedAdmin(ctx.prisma);
    const cookie = await authedCookie(request, admin.email, admin.password);
    const project = await ctx.prisma.project.create({
      data: { userId: admin.id, name: 'Test' },
    });
    return { admin, cookie, project };
  }

  describe('POST /projects/:id/links/manual', () => {
    it('creates manual links with normalized acceptor host', async () => {
      const { cookie, project } = await setupProject();

      const res = await request
        .post(`/api/v1/projects/${project.id}/links/manual`)
        .set('Cookie', cookie)
        .send({
          items: [
            { donorUrl: 'https://donor1.com/x', acceptor: 'https://www.studibucht.de/' },
            { donorUrl: 'https://donor2.com/y', acceptor: 'studibucht.de' },
          ],
        });

      expect(res.status).toBe(201);
      expect(res.body.created).toBe(2);

      const links = await ctx.prisma.link.findMany({ where: { projectId: project.id } });
      expect(links).toHaveLength(2);
      expect(links.every((l) => l.acceptorHost === 'studibucht.de')).toBe(true);
      expect(links.every((l) => l.status === 'PENDING')).toBe(true);
    });

    it('rejects empty items', async () => {
      const { cookie, project } = await setupProject();
      const res = await request
        .post(`/api/v1/projects/${project.id}/links/manual`)
        .set('Cookie', cookie)
        .send({ items: [] });
      expect(res.status).toBe(400);
    });

    it('rejects more than 1000 items', async () => {
      const { cookie, project } = await setupProject();
      const items = Array.from({ length: 1001 }, (_, i) => ({
        donorUrl: `https://d${i}.example/x`,
        acceptor: 'studibucht.de',
      }));
      const res = await request
        .post(`/api/v1/projects/${project.id}/links/manual`)
        .set('Cookie', cookie)
        .send({ items });
      expect(res.status).toBe(400);
    });

    it('rejects when any donorUrl is invalid', async () => {
      const { cookie, project } = await setupProject();
      const res = await request
        .post(`/api/v1/projects/${project.id}/links/manual`)
        .set('Cookie', cookie)
        .send({
          items: [{ donorUrl: 'not a url', acceptor: 'studibucht.de' }],
        });
      expect(res.status).toBe(400);
    });

    it('rejects without session', async () => {
      const project = await ctx.prisma.project.create({
        data: {
          name: 'X',
          user: {
            create: {
              email: `noauth-${Date.now()}@x.com`,
              passwordHash: 'h',
              role: 'ADMIN',
            },
          },
        },
      });
      const res = await request
        .post(`/api/v1/projects/${project.id}/links/manual`)
        .send({ items: [{ donorUrl: 'https://x.com', acceptor: 'y.com' }] });
      expect(res.status).toBe(401);
    });
  });

  describe('GET /projects/:id/links', () => {
    it('paginates manual links', async () => {
      const { cookie, project } = await setupProject();
      const items = Array.from({ length: 25 }, (_, i) => ({
        donorUrl: `https://d${i}.com/x`,
        acceptor: 'studibucht.de',
      }));
      await request
        .post(`/api/v1/projects/${project.id}/links/manual`)
        .set('Cookie', cookie)
        .send({ items });

      const page1 = await request
        .get(`/api/v1/projects/${project.id}/links?source=manual&page=1&limit=10`)
        .set('Cookie', cookie);
      expect(page1.status).toBe(200);
      expect(page1.body.items).toHaveLength(10);
      expect(page1.body.total).toBe(25);

      const page3 = await request
        .get(`/api/v1/projects/${project.id}/links?source=manual&page=3&limit=10`)
        .set('Cookie', cookie);
      expect(page3.body.items).toHaveLength(5);
    });
  });

  describe('DELETE endpoints', () => {
    it('deletes a single link', async () => {
      const { cookie, project } = await setupProject();
      const link = await ctx.prisma.link.create({
        data: {
          projectId: project.id,
          source: 'MANUAL',
          donorUrl: 'https://d.com',
          acceptorRaw: 'a.com',
          acceptorHost: 'a.com',
        },
      });
      const res = await request.delete(`/api/v1/links/${link.id}`).set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(await ctx.prisma.link.count()).toBe(0);
    });

    it('deletes all manual links of a project', async () => {
      const { cookie, project } = await setupProject();
      await request
        .post(`/api/v1/projects/${project.id}/links/manual`)
        .set('Cookie', cookie)
        .send({
          items: Array.from({ length: 5 }, (_, i) => ({
            donorUrl: `https://d${i}.com`,
            acceptor: 'a.com',
          })),
        });
      const res = await request
        .delete(`/api/v1/projects/${project.id}/links`)
        .set('Cookie', cookie);
      expect(res.status).toBe(200);
      expect(res.body.deleted).toBe(5);
    });

    it('cannot delete another user\u2019s link', async () => {
      const { cookie } = await setupProject();
      const otherUser = await seedAdmin(ctx.prisma, 'other@test.com');
      const otherProject = await ctx.prisma.project.create({
        data: { userId: otherUser.id, name: 'Other' },
      });
      const link = await ctx.prisma.link.create({
        data: {
          projectId: otherProject.id,
          source: 'MANUAL',
          donorUrl: 'https://d.com',
          acceptorRaw: 'a.com',
          acceptorHost: 'a.com',
        },
      });
      const res = await request.delete(`/api/v1/links/${link.id}`).set('Cookie', cookie);
      expect(res.status).toBe(404);
    });
  });

  describe('POST /projects/:id/check', () => {
    it('enqueues a manual check job and returns queued count', async () => {
      const { cookie, project } = await setupProject();
      await request
        .post(`/api/v1/projects/${project.id}/links/manual`)
        .set('Cookie', cookie)
        .send({
          items: [
            { donorUrl: 'https://d1.com', acceptor: 'a.com' },
            { donorUrl: 'https://d2.com', acceptor: 'a.com' },
          ],
        });

      const res = await request
        .post(`/api/v1/projects/${project.id}/check`)
        .set('Cookie', cookie);
      expect(res.status).toBe(201);
      expect(res.body.queued).toBe(2);
      expect(res.body.jobId).toBeDefined();
    });

    it('returns 400 when there are no eligible links', async () => {
      const { cookie, project } = await setupProject();
      const res = await request
        .post(`/api/v1/projects/${project.id}/check`)
        .set('Cookie', cookie);
      expect(res.status).toBe(400);
    });

    it('returns 409 when project lock is held', async () => {
      const { cookie, project } = await setupProject();
      await request
        .post(`/api/v1/projects/${project.id}/links/manual`)
        .set('Cookie', cookie)
        .send({
          items: [{ donorUrl: 'https://d1.com', acceptor: 'a.com' }],
        });

      // Manually hold the lock
      const lockKey = REDIS_KEYS.projectManualLock(project.id);
      await redis.set(lockKey, 'someone', 'PX', 30_000);

      const res = await request
        .post(`/api/v1/projects/${project.id}/check`)
        .set('Cookie', cookie);
      expect(res.status).toBe(409);
    });
  });

  describe('POST /links/:id/check (single recheck)', () => {
    it('enqueues a single-link job and sets cooldown', async () => {
      const { cookie, project } = await setupProject();
      const link = await ctx.prisma.link.create({
        data: {
          projectId: project.id,
          source: 'MANUAL',
          donorUrl: 'https://d.com',
          acceptorRaw: 'a.com',
          acceptorHost: 'a.com',
        },
      });

      const res = await request.post(`/api/v1/links/${link.id}/check`).set('Cookie', cookie);
      expect(res.status).toBe(201);
      expect(res.body.jobId).toBeDefined();

      const updated = await ctx.prisma.link.findUnique({ where: { id: link.id } });
      expect(updated?.lastCooldownAt).not.toBeNull();
    });

    it('returns 429 on cooldown violation', async () => {
      const { cookie, project } = await setupProject();
      const link = await ctx.prisma.link.create({
        data: {
          projectId: project.id,
          source: 'MANUAL',
          donorUrl: 'https://d.com',
          acceptorRaw: 'a.com',
          acceptorHost: 'a.com',
          lastCooldownAt: new Date(),
        },
      });

      const res = await request.post(`/api/v1/links/${link.id}/check`).set('Cookie', cookie);
      expect(res.status).toBe(429);
      expect(res.body.message).toBe('Recheck cooldown active');
      expect(res.body.retryAfterSec).toEqual(expect.any(Number));
      expect(res.body.retryAfterSec).toBeGreaterThan(0);
    });

    it('returns 409 when project lock is held', async () => {
      const { cookie, project } = await setupProject();
      const link = await ctx.prisma.link.create({
        data: {
          projectId: project.id,
          source: 'MANUAL',
          donorUrl: 'https://d.com',
          acceptorRaw: 'a.com',
          acceptorHost: 'a.com',
        },
      });
      const lockKey = REDIS_KEYS.projectManualLock(project.id);
      await redis.set(lockKey, 'someone', 'PX', 30_000);

      const res = await request.post(`/api/v1/links/${link.id}/check`).set('Cookie', cookie);
      expect(res.status).toBe(409);
    });

    it('rapid-fire 100 requests yield 1 success and 99 cooldowns', async () => {
      const { cookie, project } = await setupProject();
      const link = await ctx.prisma.link.create({
        data: {
          projectId: project.id,
          source: 'MANUAL',
          donorUrl: 'https://d.com',
          acceptorRaw: 'a.com',
          acceptorHost: 'a.com',
        },
      });

      const fastify = ctx.app.getHttpAdapter().getInstance();
      const cookieHeader = (cookie as unknown as string[]).map((c) => c.split(';')[0]).join('; ');

      const responses = await Promise.all(
        Array.from({ length: 100 }, () =>
          fastify.inject({
            method: 'POST',
            url: `/api/v1/links/${link.id}/check`,
            headers: { cookie: cookieHeader },
          }),
        ),
      );

      const counts: Record<number, number> = {};
      const samples: Record<number, string> = {};
      for (const r of responses) {
        counts[r.statusCode] = (counts[r.statusCode] ?? 0) + 1;
        if (!samples[r.statusCode]) samples[r.statusCode] = r.body;
      }
      // eslint-disable-next-line no-console
      console.log('rapid-fire status distribution:', counts, 'samples:', samples);

      const created = responses.filter((r) => r.statusCode === 201).length;
      const cooldowns = responses.filter((r) => r.statusCode === 429).length;
      expect(created).toBe(1);
      expect(cooldowns).toBe(99);
    });
  });
});
