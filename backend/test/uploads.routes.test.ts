import { Hono } from 'hono';
import { sign } from 'hono/jwt';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { MAX_UPLOAD_BYTES, uploadsRoutes } from '../src/routes/uploads.routes';
import { LocalObjectStore } from '../src/services/objectstore';

const SECRET = 'test-secret';

function token(role: 'admin' | 'customer') {
  return sign({ sub: 'user-1', email: 'admin@test.dev', role }, SECRET, 'HS256');
}

describe('uploadsRoutes (dev-only local transport)', () => {
  let dir: string;
  let store: LocalObjectStore;
  let app: Hono;

  beforeEach(async () => {
    dir = await mkdtemp(path.join(os.tmpdir(), 'uploads-routes-test-'));
    store = new LocalObjectStore(dir, 'http://localhost:4000');
    app = new Hono();
    app.route('/api/uploads', uploadsRoutes(store, SECRET));
  });

  afterEach(async () => {
    await rm(dir, { recursive: true, force: true });
  });

  const key = 'bill/2026/07/roundtrip.jpg';
  const url = `/api/uploads/local/${encodeURIComponent(key)}`;

  it('rejects PUT without a token (401)', async () => {
    const res = await app.request(url, { method: 'PUT', body: new Uint8Array([1]) });
    expect(res.status).toBe(401);
  });

  it('rejects GET without a token (401)', async () => {
    const res = await app.request(url);
    expect(res.status).toBe(401);
  });

  it('rejects a non-admin token (403)', async () => {
    const res = await app.request(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${await token('customer')}` },
      body: new Uint8Array([1]),
    });
    expect(res.status).toBe(403);
  });

  it('PUT stores the object (204) and GET streams it back with its content type', async () => {
    const bytes = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 9, 8, 7]);
    const auth = { Authorization: `Bearer ${await token('admin')}` };

    const put = await app.request(url, {
      method: 'PUT',
      headers: { ...auth, 'Content-Type': 'image/jpeg' },
      body: bytes,
    });
    expect(put.status).toBe(204);

    const get = await app.request(url, { headers: auth });
    expect(get.status).toBe(200);
    expect(get.headers.get('Content-Type')).toBe('image/jpeg');
    expect(new Uint8Array(await get.arrayBuffer())).toEqual(bytes);
  });

  it('GET for a missing key returns 404', async () => {
    const res = await app.request(`/api/uploads/local/${encodeURIComponent('bill/2026/07/nope.jpg')}`, {
      headers: { Authorization: `Bearer ${await token('admin')}` },
    });
    expect(res.status).toBe(404);
  });

  it('enforces the 10 MB size cap (413) and stores nothing', async () => {
    const tooBig = new Uint8Array(MAX_UPLOAD_BYTES + 1);
    const res = await app.request(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${await token('admin')}`, 'Content-Type': 'image/jpeg' },
      body: tooBig,
    });
    expect(res.status).toBe(413);
    expect(await store.exists(key)).toBe(false);
  });

  it('rejects an empty body (400)', async () => {
    const res = await app.request(url, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${await token('admin')}`, 'Content-Type': 'image/jpeg' },
      body: new Uint8Array(0),
    });
    expect(res.status).toBe(400);
  });

  it('rejects traversal keys (400)', async () => {
    const res = await app.request(`/api/uploads/local/${encodeURIComponent('../escape.jpg')}`, {
      method: 'PUT',
      headers: { Authorization: `Bearer ${await token('admin')}`, 'Content-Type': 'image/jpeg' },
      body: new Uint8Array([1]),
    });
    expect(res.status).toBe(400);
  });
});
