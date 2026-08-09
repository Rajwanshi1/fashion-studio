import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { SECTION_SCHEMAS } from '../src/routes/content.routes';
import { Fakes, makeFakes, fakeTx, FakeObjectStore } from './fakes';

const SECRET = 'content-test-secret';

const jsonReq = (method: string, body?: unknown, token?: string) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});

/** Smallest body each section accepts — one per key, so the round-trip test covers all 8. */
const MINIMAL_BODIES: Record<string, Record<string, unknown>> = {
  hero: { title: 'New season', imageUrl: '/img/hero.jpg' },
  featured: { title: 'The edit', ctaHref: '/shop/lehengas' },
  marquee: { items: ['Handcrafted'] },
  trust: { items: [{ title: 'a', detail: 'b' }, { title: 'c', detail: 'd' }, { title: 'e', detail: 'f' }] },
  lookbookCover: { masthead: 'Lookbook', subItems: ['Vol. I'] },
  lookbook: { looks: [{ lookNo: '01', title: 'Verdant', ctaHref: '/shop' }], quote: 'Cloth remembers.' },
  ticker: { items: ['Made to order'] },
  footer: { blurb: 'Studio notes', instagramUrl: 'https://instagram.com/tanvi' },
};

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

  it('PUT rejects a schema-valid body that would exceed the WAF body cap', async () => {
    // Every string is inside its own max(), so this passes safeParse — only the
    // byte budget stops it. Prod's WAF answers >8KB bodies with an opaque 403.
    const bigLook = {
      imageUrl: `https://cdn.example.com/${'a'.repeat(460)}.jpg`,
      lookNo: 'N'.repeat(300),
      title: 'T'.repeat(300),
      copy: 'C'.repeat(1000),
      ctaHref: `/shop/${'b'.repeat(490)}`,
    };
    const res = await app.request(
      '/api/admin/content/lookbook',
      jsonReq('PUT', { looks: Array.from({ length: 7 }, () => bigLook), quote: 'Q'.repeat(1000), quoteCite: 'S'.repeat(300) }, adminToken),
    );
    expect(res.status).toBe(400);
    expect((await res.json()).error).toMatch(/too large/i);
    const { sections } = await (await app.request('/api/content')).json();
    expect(sections.lookbook).toBeUndefined();
  });

  it('PUT rejects a link field that is not http(s)/path/mailto/tel', async () => {
    const res = await app.request('/api/admin/content/footer', jsonReq('PUT', { instagramUrl: 'javascript:alert(1)' }, adminToken));
    expect(res.status).toBe(400);
    // Blank stays legal — the admin form submits '' for socials it has not filled in.
    const ok = await app.request('/api/admin/content/footer', jsonReq('PUT', { instagramUrl: '', whatsappUrl: 'https://wa.me/91' }, adminToken));
    expect(ok.status).toBe(204);
  });

  it('DELETE resets a section to default', async () => {
    await app.request('/api/admin/content/ticker', jsonReq('PUT', { items: ['Hello'] }, adminToken));
    const del = await app.request('/api/admin/content/ticker', jsonReq('DELETE', undefined, adminToken));
    expect(del.status).toBe(204);
    const { sections } = await (await app.request('/api/content')).json();
    expect(sections.ticker).toBeUndefined();
  });

  it('DELETE rejects unknown section keys with 404', async () => {
    const res = await app.request('/api/admin/content/nope', jsonReq('DELETE', undefined, adminToken));
    expect(res.status).toBe(404);
  });

  it('MINIMAL_BODIES covers exactly the section keys the API accepts', () => {
    expect(Object.keys(MINIMAL_BODIES).sort()).toEqual(Object.keys(SECTION_SCHEMAS).sort());
  });

  // Pins every key name the storefront and admin SPAs address by string.
  it.each(Object.entries(MINIMAL_BODIES))('PUT/GET round-trips the %s section', async (key, body) => {
    const put = await app.request(`/api/admin/content/${key}`, jsonReq('PUT', body, adminToken));
    expect(put.status).toBe(204);
    const { sections } = await (await app.request('/api/content')).json();
    expect(sections[key]).toEqual(body);
  });
});
