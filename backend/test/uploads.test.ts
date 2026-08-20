import bcrypt from 'bcryptjs';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { afterAll, beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { LocalObjectStore } from '../src/services/objectstore';
import { FakeObjectStore, FakePaymentProvider, Fakes, fakeTx, makeFakes, seedCatalog } from './fakes';

const SECRET = 'uploads-test-secret';
const BASE = 'http://localhost:3001';

const post = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});

describe('product image uploads (local store)', () => {
  const dir = mkdtempSync(path.join(tmpdir(), 'ta-uploads-'));
  let app: ReturnType<typeof createApp>;
  let f: Fakes;
  let adminToken: string;
  let customerToken: string;

  afterAll(() => rmSync(dir, { recursive: true, force: true }));

  beforeEach(async () => {
    f = makeFakes();
    await seedCatalog(f.products);
    await f.users.create({
      email: 'admin@tanviagnihotry.com',
      passwordHash: await bcrypt.hash('TanviAdmin@2026', 4),
      firstName: 'Tanvi',
      lastName: 'Agnihotry',
      role: 'admin',
    });
    const local = new LocalObjectStore(dir, BASE);
    app = createApp({
      repos: f,
      paymentProvider: new FakePaymentProvider(),
      jwtSecret: SECRET,
      corsOrigins: ['http://localhost:5174'],
      runInTransaction: fakeTx,
      objectStore: local,
      localUploads: local,
    });
    const login = await app.request('/api/auth/login', post({ email: 'admin@tanviagnihotry.com', password: 'TanviAdmin@2026' }));
    adminToken = (await login.json()).token;
    const reg = await app.request(
      '/api/auth/register',
      post({ email: 'shopper@example.com', password: 'Shopper@2026', firstName: 'A', lastName: 'B' }),
    );
    customerToken = (await reg.json()).token;
  });

  it('presigns a product-image upload and round-trips the bytes end to end', async () => {
    const presign = await app.request(
      '/api/admin/uploads/product-image',
      post({ contentType: 'image/jpeg' }, adminToken),
    );
    expect(presign.status).toBe(201);
    const body = await presign.json();
    expect(body.key).toMatch(/^products\/\d{4}\/\d{2}\/[0-9a-f-]+\.jpg$/);
    expect(body.uploadUrl).toContain('/api/uploads/local/');
    expect(body.headers).toEqual({ 'Content-Type': 'image/jpeg' });
    // Permanent URL, not a short-lived signed one.
    expect(body.publicUrl).toBe(`${BASE}/api/uploads/local/${encodeURIComponent(body.key)}`);

    // PUT the bytes through the dev transport (admin-gated).
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3]);
    const putPath = body.uploadUrl.replace(BASE, '');
    const put = await app.request(putPath, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${adminToken}` },
      body: bytes,
    });
    expect(put.status).toBe(204);

    // GET is public — the storefront <img> must be able to read it.
    const get = await app.request(putPath);
    expect(get.status).toBe(200);
    expect(get.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes);
  });

  it('is not tripped by the 100KB JSON body limit', async () => {
    const presign = await app.request(
      '/api/admin/uploads/product-image',
      post({ contentType: 'image/jpeg' }, adminToken),
    );
    const { uploadUrl } = await presign.json();
    const big = new Uint8Array(300 * 1024); // 300KB > the 100KB JSON cap
    const put = await app.request(uploadUrl.replace(BASE, ''), {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${adminToken}` },
      body: big,
    });
    expect(put.status).toBe(204);
  });

  it('gates presign and local PUT to admins; rejects bad content types and traversal', async () => {
    expect((await app.request('/api/admin/uploads/product-image', post({ contentType: 'image/jpeg' }))).status).toBe(401);
    expect(
      (await app.request('/api/admin/uploads/product-image', post({ contentType: 'image/jpeg' }, customerToken))).status,
    ).toBe(403);
    expect(
      (await app.request('/api/admin/uploads/product-image', post({ contentType: 'image/png' }, adminToken))).status,
    ).toBe(400);

    const anonPut = await app.request(`/api/uploads/local/${encodeURIComponent('products/x.jpg')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([1]),
    });
    expect(anonPut.status).toBe(401);

    const traversal = await app.request(`/api/uploads/local/${encodeURIComponent('../escape.jpg')}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'image/jpeg', Authorization: `Bearer ${adminToken}` },
      body: new Uint8Array([1]),
    });
    expect(traversal.status).toBe(400);
  });

  it('presigns one PUT per requested rendition width, keys derived from the master key', async () => {
    const presign = await app.request(
      '/api/admin/uploads/product-image',
      post({ contentType: 'image/jpeg', renditionWidths: [320, 640, 1080] }, adminToken),
    );
    expect(presign.status).toBe(201);
    const body = await presign.json();
    expect(body.renditions).toHaveLength(3);
    expect(body.renditions.map((r: any) => r.width)).toEqual([320, 640, 1080]);
    for (const rendition of body.renditions) {
      expect(rendition.key).toBe(body.key.replace(/\.jpg$/, `_w${rendition.width}.jpg`));
      expect(rendition.uploadUrl).toContain('/api/uploads/local/');
      expect(rendition.headers['Content-Type']).toBe('image/jpeg');
    }
    // No widths requested → an empty renditions list, not an absent field.
    const bare = await (
      await app.request('/api/admin/uploads/product-image', post({ contentType: 'image/jpeg' }, adminToken))
    ).json();
    expect(bare.renditions).toEqual([]);
  });

  it('rejects out-of-range rendition widths', async () => {
    const res = await app.request(
      '/api/admin/uploads/product-image',
      post({ contentType: 'image/jpeg', renditionWidths: [50] }, adminToken),
    );
    expect(res.status).toBe(400);
  });

  it('stamps immutable Cache-Control into the S3-style presign headers (master + renditions)', async () => {
    // The S3 contract is what matters here — the FakeObjectStore mirrors
    // S3ObjectStore's header behaviour; the LocalObjectStore deliberately
    // ignores cacheControl (dev CORS only allows Content-Type/Authorization).
    const s3ish = createApp({
      repos: f,
      paymentProvider: new FakePaymentProvider(),
      jwtSecret: SECRET,
      corsOrigins: [],
      runInTransaction: fakeTx,
      objectStore: new FakeObjectStore(),
    });
    const login = await s3ish.request(
      '/api/auth/login',
      post({ email: 'admin@tanviagnihotry.com', password: 'TanviAdmin@2026' }),
    );
    const token = (await login.json()).token;
    const body = await (
      await s3ish.request(
        '/api/admin/uploads/product-image',
        post({ contentType: 'image/jpeg', renditionWidths: [320, 640] }, token),
      )
    ).json();
    const immutable = 'public,max-age=31536000,immutable';
    expect(body.headers).toEqual({ 'Content-Type': 'image/jpeg', 'Cache-Control': immutable });
    for (const rendition of body.renditions) {
      expect(rendition.headers).toEqual({ 'Content-Type': 'image/jpeg', 'Cache-Control': immutable });
    }
  });

  it('answers 503 when uploads are not configured', async () => {
    const bare = createApp({
      repos: f,
      paymentProvider: new FakePaymentProvider(),
      jwtSecret: SECRET,
      corsOrigins: [],
      runInTransaction: fakeTx,
    });
    const login = await bare.request('/api/auth/login', post({ email: 'admin@tanviagnihotry.com', password: 'TanviAdmin@2026' }));
    const token = (await login.json()).token;
    const res = await bare.request('/api/admin/uploads/product-image', post({ contentType: 'image/jpeg' }, token));
    expect(res.status).toBe(503);
  });
});
