import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createTestApp, resetDb, seedAdmin, type TestApp } from './helpers/app';

async function authedCookie(
  request: ReturnType<typeof supertest>,
  email: string,
  password: string,
): Promise<string[]> {
  const res = await request.post('/api/v1/auth/login').send({ email, password });
  return res.headers['set-cookie'] as unknown as string[];
}

describe('Projects (integration)', () => {
  let ctx: TestApp;
  let request: ReturnType<typeof supertest>;

  beforeAll(async () => {
    ctx = await createTestApp();
    request = supertest(ctx.app.getHttpServer());
  });

  afterAll(async () => {
    await ctx.close();
  });

  beforeEach(async () => {
    await resetDb(ctx.prisma);
  });

  it('rejects unauthenticated requests with 401', async () => {
    expect((await request.get('/api/v1/projects')).status).toBe(401);
    expect((await request.post('/api/v1/projects').send({ name: 'X' })).status).toBe(401);
  });

  it('creates a project and returns it in the list', async () => {
    const admin = await seedAdmin(ctx.prisma);
    const cookie = await authedCookie(request, admin.email, admin.password);

    const create = await request
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'Demo', description: 'a project' });
    expect(create.status).toBe(201);
    expect(create.body).toMatchObject({ name: 'Demo', description: 'a project' });

    const list = await request.get('/api/v1/projects').set('Cookie', cookie);
    expect(list.status).toBe(200);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({
      name: 'Demo',
      manualChecking: false,
      sheetsChecking: false,
      linksCount: 0,
      sheetsTasksCount: 0,
    });
  });

  it('Zod-validates the create payload', async () => {
    const admin = await seedAdmin(ctx.prisma);
    const cookie = await authedCookie(request, admin.email, admin.password);

    const empty = await request.post('/api/v1/projects').set('Cookie', cookie).send({});
    expect(empty.status).toBe(400);

    const tooLong = await request
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'x'.repeat(200) });
    expect(tooLong.status).toBe(400);
  });

  it('isolates projects by user (no cross-tenant leakage)', async () => {
    const a = await seedAdmin(ctx.prisma, 'a@test.com');
    const b = await seedAdmin(ctx.prisma, 'b@test.com');
    const cookieA = await authedCookie(request, a.email, a.password);
    const cookieB = await authedCookie(request, b.email, b.password);

    await request.post('/api/v1/projects').set('Cookie', cookieA).send({ name: 'A' });
    await request.post('/api/v1/projects').set('Cookie', cookieB).send({ name: 'B' });

    const listA = await request.get('/api/v1/projects').set('Cookie', cookieA);
    const listB = await request.get('/api/v1/projects').set('Cookie', cookieB);

    expect(listA.body).toHaveLength(1);
    expect(listA.body[0].name).toBe('A');
    expect(listB.body).toHaveLength(1);
    expect(listB.body[0].name).toBe('B');
  });

  it('updates and deletes a project', async () => {
    const admin = await seedAdmin(ctx.prisma);
    const cookie = await authedCookie(request, admin.email, admin.password);

    const create = await request
      .post('/api/v1/projects')
      .set('Cookie', cookie)
      .send({ name: 'Old' });
    const id = create.body.id;

    const patch = await request
      .patch(`/api/v1/projects/${id}`)
      .set('Cookie', cookie)
      .send({ name: 'New' });
    expect(patch.status).toBe(200);
    expect(patch.body.name).toBe('New');

    const del = await request.delete(`/api/v1/projects/${id}`).set('Cookie', cookie);
    expect(del.status).toBe(200);

    const list = await request.get('/api/v1/projects').set('Cookie', cookie);
    expect(list.body).toHaveLength(0);
  });

  it('returns 404 when accessing another user’s project by id', async () => {
    const a = await seedAdmin(ctx.prisma, 'a2@test.com');
    const b = await seedAdmin(ctx.prisma, 'b2@test.com');
    const cookieA = await authedCookie(request, a.email, a.password);
    const cookieB = await authedCookie(request, b.email, b.password);

    const create = await request
      .post('/api/v1/projects')
      .set('Cookie', cookieA)
      .send({ name: 'Mine' });
    const id = create.body.id;

    const res = await request.get(`/api/v1/projects/${id}`).set('Cookie', cookieB);
    expect(res.status).toBe(404);
  });

  /**
   * Mini-load: 50 concurrent project creates from one user.
   * Goal: no 5xx, exactly 50 rows in DB. This is the smallest "load" check
   * we promised in the test policy — full multi-user load lives in tests/load/
   * starting Phase 3.
   *
   * We use Fastify's inject() (in-memory request, no TCP) instead of supertest
   * for this test. supertest opens a real socket per request, and Node's HTTP
   * agent under heavy parallelism can ECONNRESET on in-process servers. inject()
   * bypasses TCP entirely and is the canonical way to load-test Fastify apps.
   */
  it('handles 50 concurrent creates from one user without errors', async () => {
    const admin = await seedAdmin(ctx.prisma);
    const cookie = await authedCookie(request, admin.email, admin.password);
    const cookieHeader = (cookie as unknown as string[]).map((c) => c.split(';')[0]).join('; ');

    const fastify = ctx.app.getHttpAdapter().getInstance();

    const N = 50;
    const results = await Promise.all(
      Array.from({ length: N }, (_, i) =>
        fastify.inject({
          method: 'POST',
          url: '/api/v1/projects',
          headers: {
            cookie: cookieHeader,
            'content-type': 'application/json',
          },
          payload: { name: `P${i}` },
        }),
      ),
    );

    for (const r of results) {
      expect(r.statusCode).toBe(201);
    }

    const list = await request.get('/api/v1/projects').set('Cookie', cookie);
    expect(list.body).toHaveLength(N);
  });
});
