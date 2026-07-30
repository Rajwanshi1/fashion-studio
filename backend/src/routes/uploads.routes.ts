// Dev-only local upload transport. This router is ONLY mounted when the
// LocalObjectStore is active (no S3 bucket configured) — in production the
// admin SPA PUTs directly to a presigned S3 URL and product images are read
// straight from S3, so this router never exists.
//
// NOTE FOR WIRING: mount this router OUTSIDE the app-wide 100KB bodyLimit —
// photo uploads are up to 10 MB. The router still enforces its own size cap.
import { Hono } from 'hono';
import { AuthEnv, requireAdmin, requireAuth } from '../middleware/auth';
import type { LocalObjectStore } from '../services/objectstore';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

export function uploadsRoutes(store: LocalObjectStore, jwtSecret: string) {
  const r = new Hono<AuthEnv>();

  // PUT is admin-only (uploads come exclusively from the admin SPA).
  // GET stays public: it stands in for the public-read S3 prefix, so the
  // storefront's <img src> works against a locally stored product photo.
  //
  // The :key param is a full storage key (`products/2026/07/<uuid>.jpg`) sent
  // percent-encoded as a single path segment; Hono decodes it for us.
  r.put('/local/:key', requireAuth(jwtSecret), requireAdmin, async (c) => {
    const key = c.req.param('key');
    if (key.split('/').includes('..')) return c.json({ error: 'Invalid key' }, 400);

    // Reject oversized uploads by declared length first (cheap), then verify
    // against the actual bytes — Content-Length can be absent or a lie.
    const declared = Number(c.req.header('Content-Length') ?? '0');
    if (declared > MAX_UPLOAD_BYTES) return c.json({ error: 'File too large (max 10 MB)' }, 413);
    const body = new Uint8Array(await c.req.arrayBuffer());
    if (body.byteLength > MAX_UPLOAD_BYTES) return c.json({ error: 'File too large (max 10 MB)' }, 413);
    if (body.byteLength === 0) return c.json({ error: 'Empty body' }, 400);

    const contentType = c.req.header('Content-Type') ?? 'application/octet-stream';
    await store.put(key, body, contentType);
    return c.body(null, 204);
  });

  r.get('/local/:key', async (c) => {
    const key = c.req.param('key');
    if (key.split('/').includes('..')) return c.json({ error: 'Invalid key' }, 400);
    if (!(await store.exists(key))) return c.json({ error: 'Not found' }, 404);
    const { bytes, contentType } = await store.getObject(key);
    return c.body(bytes, 200, { 'Content-Type': contentType });
  });

  return r;
}
