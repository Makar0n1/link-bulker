import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createTestApp, resetDb, seedAdmin, type TestApp } from './helpers/app';

async function authedCookie(
  request: supertest.SuperTest<supertest.Test>,
  email: string,
  password: string,
): Promise<string[]> {
  const res = await request.post('/api/v1/auth/login').send({ email, password });
  return res.headers['set-cookie'] as unknown as string[];
}

describe('Stats (integration)', () => {
  let ctx: TestApp;
  let request: supertest.SuperTest<supertest.Test>;

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

  async function setupProject() {
    const admin = await seedAdmin(ctx.prisma);
    const cookie = await authedCookie(request, admin.email, admin.password);
    const project = await ctx.prisma.project.create({
      data: { userId: admin.id, name: 'Test' },
    });
    return { admin, cookie, project };
  }

  async function seedLink(
    projectId: string,
    overrides: Partial<{
      source: 'MANUAL' | 'SHEETS';
      donorUrl: string;
      status: 'PENDING' | 'QUEUED' | 'CHECKING' | 'DONE' | 'ERROR';
      donorStatusCode: number | null;
      donorIndexable: boolean | null;
      donorCanonical: string | null;
      canonicalMatches: boolean | null;
      linkFound: boolean | null;
      occurrences: any[] | null;
      checkDurationMs: number | null;
    }> = {},
  ) {
    return ctx.prisma.link.create({
      data: {
        projectId,
        source: overrides.source ?? 'MANUAL',
        donorUrl: overrides.donorUrl ?? 'https://donor.example/x',
        acceptorRaw: 'studibucht.de',
        acceptorHost: 'studibucht.de',
        status: overrides.status ?? 'DONE',
        donorStatusCode: overrides.donorStatusCode ?? 200,
        donorIndexable: overrides.donorIndexable ?? true,
        donorCanonical: overrides.donorCanonical ?? null,
        canonicalMatches: overrides.canonicalMatches ?? true,
        linkFound: overrides.linkFound ?? true,
        occurrences: (overrides.occurrences ?? [
          { href: 'https://studibucht.de/x', anchor: 'a', rel: [], target: null, tag: 'a', position: 0 },
        ]) as any,
        occurrencesCount: (overrides.occurrences ?? [{}]).length,
        checkDurationMs: overrides.checkDurationMs ?? 500,
      },
    });
  }

  it('returns empty stats for an empty project', async () => {
    const { cookie, project } = await setupProject();
    const res = await request.get(`/api/v1/projects/${project.id}/stats`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.scope).toBe('all');
    expect(res.body.totals).toEqual({ total: 0, done: 0, problem: 0, error: 0, pending: 0 });
    expect(res.body.found.total).toBe(0);
    expect(res.body.timing.avgMs).toBeNull();
    expect(res.body.topProblemDonors).toEqual([]);
  });

  it('counts done/problem/error/pending correctly', async () => {
    const { cookie, project } = await setupProject();
    // 2 done (200, found, indexable)
    await seedLink(project.id, { donorUrl: 'https://a.com/1' });
    await seedLink(project.id, { donorUrl: 'https://a.com/2' });
    // 1 problem (404)
    await seedLink(project.id, { donorUrl: 'https://b.com/1', donorStatusCode: 404 });
    // 1 problem (not found)
    await seedLink(project.id, { donorUrl: 'https://c.com/1', linkFound: false });
    // 1 problem (not indexable)
    await seedLink(project.id, { donorUrl: 'https://d.com/1', donorIndexable: false });
    // 1 error
    await seedLink(project.id, { donorUrl: 'https://e.com/1', status: 'ERROR' });
    // 1 pending
    await seedLink(project.id, { donorUrl: 'https://f.com/1', status: 'PENDING', linkFound: null });

    const res = await request.get(`/api/v1/projects/${project.id}/stats`).set('Cookie', cookie);
    expect(res.status).toBe(200);
    expect(res.body.totals).toMatchObject({
      total: 7,
      done: 2,
      problem: 3,
      error: 1,
      pending: 1,
    });
  });

  it('classifies dofollow vs nofollow', async () => {
    const { cookie, project } = await setupProject();
    await seedLink(project.id, { donorUrl: 'https://a.com', occurrences: [{ rel: [] }] });
    await seedLink(project.id, { donorUrl: 'https://b.com', occurrences: [{ rel: ['nofollow'] }] });
    await seedLink(project.id, {
      donorUrl: 'https://c.com',
      occurrences: [{ rel: ['sponsored'] }, { rel: [] }],
    });
    const res = await request.get(`/api/v1/projects/${project.id}/stats`).set('Cookie', cookie);
    expect(res.body.found).toEqual({ total: 3, dofollow: 2, nofollow: 1 });
  });

  it('buckets HTTP codes', async () => {
    const { cookie, project } = await setupProject();
    await seedLink(project.id, { donorUrl: 'https://a.com', donorStatusCode: 200 });
    await seedLink(project.id, { donorUrl: 'https://b.com', donorStatusCode: 301 });
    await seedLink(project.id, { donorUrl: 'https://c.com', donorStatusCode: 404 });
    await seedLink(project.id, { donorUrl: 'https://d.com', donorStatusCode: 500 });
    await seedLink(project.id, { donorUrl: 'https://e.com', donorStatusCode: 418 });
    const res = await request.get(`/api/v1/projects/${project.id}/stats`).set('Cookie', cookie);
    expect(res.body.http).toEqual({ ok: 1, redirect: 1, notFound: 1, serverError: 1, other: 1 });
  });

  it('counts canonical match/mismatch/notFound', async () => {
    const { cookie, project } = await setupProject();
    // match
    await seedLink(project.id, {
      donorUrl: 'https://a.com',
      donorCanonical: 'https://a.com',
      canonicalMatches: true,
    });
    // mismatch
    await seedLink(project.id, {
      donorUrl: 'https://b.com',
      donorCanonical: 'https://other.com',
      canonicalMatches: false,
    });
    // not found (canonical absent on a DONE row)
    await seedLink(project.id, { donorUrl: 'https://c.com', donorCanonical: null });
    const res = await request.get(`/api/v1/projects/${project.id}/stats`).set('Cookie', cookie);
    expect(res.body.canonical).toMatchObject({ match: 1, mismatch: 1, notFound: 1 });
  });

  it('produces top problem donors sorted by count', async () => {
    const { cookie, project } = await setupProject();
    // bad.com — 3 problems
    await seedLink(project.id, { donorUrl: 'https://bad.com/1', donorStatusCode: 404 });
    await seedLink(project.id, { donorUrl: 'https://bad.com/2', donorStatusCode: 500 });
    await seedLink(project.id, { donorUrl: 'https://bad.com/3', linkFound: false });
    // worse.com — 1 problem
    await seedLink(project.id, { donorUrl: 'https://worse.com/1', linkFound: false });
    // good.com — 0 problems
    await seedLink(project.id, { donorUrl: 'https://good.com/1' });

    const res = await request.get(`/api/v1/projects/${project.id}/stats`).set('Cookie', cookie);
    expect(res.body.topProblemDonors).toEqual([
      { donorHost: 'bad.com', problemCount: 3 },
      { donorHost: 'worse.com', problemCount: 1 },
    ]);
  });

  it('filters by source=manual', async () => {
    const { cookie, project } = await setupProject();
    await seedLink(project.id, { source: 'MANUAL' });
    await seedLink(project.id, { source: 'MANUAL' });
    await seedLink(project.id, { source: 'SHEETS' });

    const all = await request.get(`/api/v1/projects/${project.id}/stats`).set('Cookie', cookie);
    expect(all.body.totals.total).toBe(3);

    const manual = await request
      .get(`/api/v1/projects/${project.id}/stats?source=manual`)
      .set('Cookie', cookie);
    expect(manual.body.scope).toBe('manual');
    expect(manual.body.totals.total).toBe(2);

    const sheets = await request
      .get(`/api/v1/projects/${project.id}/stats?source=sheets`)
      .set('Cookie', cookie);
    expect(sheets.body.scope).toBe('sheets');
    expect(sheets.body.totals.total).toBe(1);
  });

  it('computes timing percentiles when there are durations', async () => {
    const { cookie, project } = await setupProject();
    // 5 rows with known durations
    for (const ms of [100, 200, 300, 400, 500]) {
      await seedLink(project.id, { donorUrl: `https://a.com/${ms}`, checkDurationMs: ms });
    }
    const res = await request.get(`/api/v1/projects/${project.id}/stats`).set('Cookie', cookie);
    expect(res.body.timing.avgMs).toBe(300);
    expect(res.body.timing.p50Ms).toBeGreaterThanOrEqual(200);
    expect(res.body.timing.p50Ms).toBeLessThanOrEqual(400);
    expect(res.body.timing.p95Ms).toBe(500);
  });

  it('returns 401 without session', async () => {
    const project = await ctx.prisma.project.create({
      data: {
        name: 'X',
        user: {
          create: {
            email: `noauth-stats-${Date.now()}@x.com`,
            passwordHash: 'h',
            role: 'ADMIN',
          },
        },
      },
    });
    const res = await request.get(`/api/v1/projects/${project.id}/stats`);
    expect(res.status).toBe(401);
  });

  it("returns 404 for another user's project", async () => {
    const { cookie } = await setupProject();
    const other = await seedAdmin(ctx.prisma, 'other-stats@test.com');
    const otherProject = await ctx.prisma.project.create({
      data: { userId: other.id, name: 'Other' },
    });
    const res = await request
      .get(`/api/v1/projects/${otherProject.id}/stats`)
      .set('Cookie', cookie);
    expect(res.status).toBe(404);
  });
});
