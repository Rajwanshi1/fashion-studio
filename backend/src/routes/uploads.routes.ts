// Dev-only local upload transport. This router is ONLY mounted when the
// LocalObjectStore is active (no S3 bucket configured) — in production the
// admin SPA PUTs directly to a presigned S3 URL, product images are read
// straight from the public-read `products/` prefix and documents are read
// through short-lived presigned GETs, so this router never exists.
//
// NOTE FOR WIRING: mount this router OUTSIDE the app-wide 100KB bodyLimit —
// photo uploads are up to 10 MB. The router still enforces its own size cap.
import type { MiddlewareHandler } from 'hono';
import { Hono } from 'hono';
import { AuthEnv, requireAdmin, requireAuth } from '../middleware/auth';
import type { LocalObjectStore } from '../services/objectstore';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024; // 10 MB

/** Keys under this prefix stand in for the public-read S3 prefix. */
export const PUBLIC_READ_PREFIX = 'products/';

/**
 * Reads are admin-only EXCEPT for product photos. That exception exists because
 * this transport stands in for a public-read S3 prefix, so the storefront's
 * plain `<img src>` has to work unauthenticated in dev. Every other prefix
 * holds a customer document — a bill carries a name, phone and address — and
 * stays admin-only, matching the private prefixes on the real bucket.
 */
function requireAdminUnlessPublic(jwtSecret: string): MiddlewareHandler<AuthEnv> {
  const auth = requireAuth(jwtSecret);
  return async (c, next) => {
    if ((c.req.param('key') ?? '').startsWith(PUBLIC_READ_PREFIX)) return next();
    return auth(c, async () => {
      // requireAdmin answers 403 by returning a Response; assigning it to c.res
      // is what carries it back out through the requireAuth wrapper.
      const forbidden = await requireAdmin(c, next);
      if (forbidden) c.res = forbidden;
    });
  };
}

export function uploadsRoutes(store: LocalObjectStore, jwtSecret: string) {
  const r = new Hono<AuthEnv>();

  // Writes are always admin-only: uploads come exclusively from the admin SPA.
  //
  // The :key param is a full storage key (`bill/2026/07/<uuid>.jpg`) sent
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

  r.get('/local/:key', requireAdminUnlessPublic(jwtSecret), async (c) => {
    const key = c.req.param('key');
    if (key.split('/').includes('..')) return c.json({ error: 'Invalid key' }, 400);
    if (!(await store.exists(key))) return c.json({ error: 'Not found' }, 404);
    const { bytes, contentType } = await store.getObject(key);
    return c.body(bytes, 200, { 'Content-Type': contentType });
  });

  return r;
}
