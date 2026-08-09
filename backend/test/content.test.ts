import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { Fakes, makeFakes, fakeTx, FakeObjectStore } from './fakes';

const SECRET = 'content-test-secret';

const jsonReq = (method: string, body?: unknown, token?: string) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

describe('site content API', () => {
  let app: ReturnType<typeof createApp>;
  let f: Fakes;
  let adminToken: string;
  let customerToken: string;

  beforeEach(async () => {
    f = makeFakes();
    await f.users.create({
      email: 'admin@tanviagnihotry.com',
      passwordHash: await bcrypt.hash('TanviAdmin@2026', 4),
      firstName: 'Tanvi',
      lastName: 'Agnihotry',
      role: 'admin',
    });
    app = createApp({
      repos: f,
      paymentProvider: null,
      objectStore: new FakeObjectStore(),
      jwtSecret: SECRET,
      corsOrigins: ['http://localhost'],
      runInTransaction: fakeTx,
    });
    const login = await app.request(
      '/api/auth/login',
      jsonReq('POST', { email: 'admin@tanviagnihotry.com', password: 'TanviAdmin@2026' }),
    );
    adminToken = (await login.json()).token;
    const register = await app.request(
      '/api/auth/register',
      jsonReq('POST', { email: 'aanya@example.com', password: 'Aanya@2026', firstName: 'Aanya', lastName: 'Mehra' }),
    );
    customerToken = (await register.json()).token;
  });

  it('GET /api/content starts empty and is public', async () => {
    const res = await app.request('/api/content');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ sections: {} });
  });

  it('PUT round-trips a section and GET returns it', async () => {
    const hero = { title: 'New season', eyebrow: 'The Verdant Edit' };
    const put = await app.request('/api/admin/content/hero', jsonReq('PUT', hero, adminToken));
    expect(put.status).toBe(204);
    const { sections } = await (await app.request('/api/content')).json();
    expect(sections.hero).toEqual(hero);
  });

  it('PUT requires an admin token', async () => {
    expect((await app.request('/api/admin/content/hero', jsonReq('PUT', { title: 'x' }))).status).toBe(401);
    expect((await app.request('/api/admin/content/hero', jsonReq('PUT', { title: 'x' }, customerToken))).status).toBe(403);
  });

  it('PUT rejects unknown section keys with 404', async () => {
    const res = await app.request('/api/admin/content/nope', jsonReq('PUT', {}, adminToken));
    expect(res.status).toBe(404);
  });

  it('PUT rejects a body that fails the section schema', async () => {
    // trust requires exactly 3 items; junk keys are rejected by .strict()
    const bad1 = await app.request('/api/admin/content/trust', jsonReq('PUT', { items: [{ title: 'a', detail: 'b' }] }, adminToken));
    expect(bad1.status).toBe(400);
    const bad2 = await app.request('/api/admin/content/hero', jsonReq('PUT', { title: 'x', hax: 1 }, adminToken));
    expect(bad2.status).toBe(400);
  });

  it('DELETE resets a section to default', async () => {
    await app.request('/api/admin/content/ticker', jsonReq('PUT', { items: ['Hello'] }, adminToken));
    const del = await app.request('/api/admin/content/ticker', jsonReq('DELETE', undefined, adminToken));
    expect(del.status).toBe(204);
    const { sections } = await (await app.request('/api/content')).json();
    expect(sections.ticker).toBeUndefined();
  });
});
