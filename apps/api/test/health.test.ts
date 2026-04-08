import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createTestApp, type TestApp } from './helpers/app';

describe('Health (integration)', () => {
  let ctx: TestApp;
  let request: supertest.SuperTest<supertest.Test>;

  beforeAll(async () => {
    ctx = await createTestApp();
    request = supertest(ctx.app.getHttpServer());
  });

  afterAll(async () => {
    await ctx.close();
  });

  it('GET /health returns 200 with uptime', async () => {
    const res = await request.get('/api/v1/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
    expect(typeof res.body.uptimeSec).toBe('number');
  });

  it('GET /health/deep checks postgres and redis', async () => {
    const res = await request.get('/api/v1/health/deep');
    expect(res.status).toBe(200);
    expect(res.body.checks.postgres).toBe('ok');
    expect(res.body.checks.redis).toBe('ok');
  });
});
