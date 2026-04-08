import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import supertest from 'supertest';
import { createTestApp, resetDb, seedAdmin, type TestApp } from './helpers/app';

describe('Auth (integration)', () => {
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

  it('logs in with correct credentials and sets a signed cookie', async () => {
    const admin = await seedAdmin(ctx.prisma);

    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: admin.password });

    expect(res.status).toBe(200);
    expect(res.body.user).toMatchObject({ email: admin.email, role: 'ADMIN' });

    const setCookie = res.headers['set-cookie'];
    expect(setCookie).toBeTruthy();
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    expect(cookieStr).toMatch(/lc_session=/);
    expect(cookieStr).toMatch(/HttpOnly/i);
    expect(cookieStr).toMatch(/SameSite=Lax/i);
  });

  it('rejects invalid password with 401', async () => {
    const admin = await seedAdmin(ctx.prisma);

    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: 'wrong' });

    expect(res.status).toBe(401);
  });

  it('rejects unknown email with 401', async () => {
    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: 'nope@example.com', password: 'whatever' });

    expect(res.status).toBe(401);
  });

  it('rejects malformed body with 400', async () => {
    const res = await request
      .post('/api/v1/auth/login')
      .send({ email: 'not-an-email', password: '' });

    expect(res.status).toBe(400);
  });

  it('GET /auth/me requires session', async () => {
    const res = await request.get('/api/v1/auth/me');
    expect(res.status).toBe(401);
  });

  it('GET /auth/me returns the current user when authenticated', async () => {
    const admin = await seedAdmin(ctx.prisma);

    const login = await request
      .post('/api/v1/auth/login')
      .send({ email: admin.email, password: admin.password });
    const cookie = login.headers['set-cookie'] as unknown as string[];

    const me = await request.get('/api/v1/auth/me').set('Cookie', cookie);
    expect(me.status).toBe(200);
    expect(me.body.user).toMatchObject({ email: admin.email, role: 'ADMIN' });
  });

  it('POST /auth/logout clears the cookie', async () => {
    const res = await request.post('/api/v1/auth/logout');
    expect(res.status).toBe(200);
    const setCookie = res.headers['set-cookie'];
    const cookieStr = Array.isArray(setCookie) ? setCookie.join('; ') : String(setCookie);
    expect(cookieStr).toMatch(/lc_session=/);
    // either explicitly empty or expires in the past
    expect(cookieStr).toMatch(/(Expires=Thu, 01 Jan 1970|Max-Age=0|lc_session=;)/i);
  });
});
