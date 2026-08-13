// Admin-editable storefront content. Fixed section keys, one zod schema per
// section; the storefront merges these over its built-in defaults, so every
// field is optional — an admin save always sends the full object anyway.
import { Hono } from 'hono';
import { z } from 'zod';
import { AuthEnv, requireAdmin, requireAuth } from '../middleware/auth';
import type { ContentRepo } from '../data/content.repo';

/**
 * Prod sits behind a WAF that rejects request bodies over 8KB with an opaque
 * edge 403 — no API error body, nothing in the app logs. The per-field max()es
 * below are code-point counts, so a Devanagari or emoji save can be 2-3x its
 * character length in bytes and a full 7-look lookbook can clear 8KB even when
 * every field is legal. Budget the encoded section well under the cap so an
 * over-long save fails here, readably, instead of there.
 */
const MAX_SECTION_BYTES = 6 * 1024;

const str = z.string().max(300);
const copy = z.string().max(1000);
// Links land in href/src on the public storefront; only an admin writes them,
// but keep `javascript:` and friends out. '' is legal — the admin form submits
// blanks for socials the studio has not set. The path branch excludes a second
// slash *or a backslash*: `//evil.com` is protocol-relative, and browsers
// normalise the backslash in `/\evil.com` to one — both are off-site links
// wearing a path's clothes.
const url = z
  .string()
  .max(500)
  .refine((v) => v === '' || /^(https?:\/\/|\/(?![\/\\])|mailto:|tel:)/i.test(v), 'Must be a link (https://…, /path, mailto: or tel:)');
const image = url.nullable();
// Focal point of an image, percent of the source photo (object-position on the
// storefront). Absent means 50/50 — the object-fit: cover default, centred.
const pct = z.number().int().min(0).max(100);

const look = z.object({
  imageUrl: image, focusX: pct, focusY: pct, lookNo: str, title: str, copy, ctaHref: url,
}).partial().strict();

export const SECTION_SCHEMAS = {
  hero: z.object({
    imageUrl: image, focusX: pct, focusY: pct, seasonLabel: str, eyebrow: str, title: str,
    titleItalic: str, ctaPrimary: str, ctaSecondary: str, edgeLeft: str, edgeRight: str,
  }).partial().strict(),
  featured: z.object({
    imageUrl: image, focusX: pct, focusY: pct, eyebrow: str, title: str, titleEm: str,
    copy, ctaLabel: str, ctaHref: url,
  }).partial().strict(),
  marquee: z.object({ items: z.array(str.min(1)).max(8) }).strict(),
  trust: z.object({ items: z.array(z.object({ title: str, detail: str }).strict()).length(3) }).strict(),
  lookbookCover: z.object({
    imageUrl: image, focusX: pct, focusY: pct, masthead: str, subItems: z.array(str).max(4),
  }).partial().strict(),
  lookbook: z.object({ looks: z.array(look).max(7), quote: copy, quoteCite: str }).partial().strict(),
  ticker: z.object({ items: z.array(str.min(1)).max(8) }).strict(),
  footer: z.object({ blurb: copy, instagramUrl: url, pinterestUrl: url, whatsappUrl: url }).partial().strict(),
  // Brand facts — the one place the address, phone and collection name live.
  // Pages read these instead of hardcoding; piece counts are never a fact
  // field (they come from the catalogue, or they drift into fiction).
  facts: z.object({
    addressLines: z.array(str).max(4), phone: str, email: str,
    collectionName: str, leadStandard: str, leadCustom: str,
  }).partial().strict(),
  // The permanent archive: every edition ever made, never deleted. Piece
  // counts are computed from the catalogue by the storefront — not stored.
  // Budget: 6 volumes of short copy sits far under MAX_SECTION_BYTES.
  archive: z.object({
    intro: copy,
    volumes: z.array(z.object({
      imageUrl: image, focusX: pct, focusY: pct, volumeNo: str, title: str,
      season: str, copy, collections: z.array(str).max(8), status: str,
    }).partial().strict()).max(6),
  }).partial().strict(),
} as const;

export type SectionKey = keyof typeof SECTION_SCHEMAS;

function schemaFor(key: string): z.ZodTypeAny | null {
  return Object.prototype.hasOwnProperty.call(SECTION_SCHEMAS, key)
    ? SECTION_SCHEMAS[key as SectionKey]
    : null;
}

export function contentRoutes(content: ContentRepo, jwtSecret: string) {
  const r = new Hono<AuthEnv>();

  // Public — the storefront fetches this once per visit and merges over defaults.
  r.get('/content', async (c) => {
    const rows = await content.all();
    return c.json({ sections: Object.fromEntries(rows.map((row) => [row.key, row.value])) });
  });

  r.put('/admin/content/:key', requireAuth(jwtSecret), requireAdmin, async (c) => {
    const key = c.req.param('key');
    const schema = schemaFor(key);
    if (!schema) return c.json({ error: 'Unknown section' }, 404);
    const parsed = schema.safeParse(await c.req.json().catch(() => undefined));
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      return c.json({ error: `${issue.path.join('.') || key}: ${issue.message}` }, 400);
    }
    if (Buffer.byteLength(JSON.stringify(parsed.data)) > MAX_SECTION_BYTES) {
      return c.json({ error: 'Section too large — shorten the copy' }, 400);
    }
    await content.upsert(key, parsed.data);
    return c.body(null, 204);
  });

  r.delete('/admin/content/:key', requireAuth(jwtSecret), requireAdmin, async (c) => {
    const key = c.req.param('key');
    if (!schemaFor(key)) return c.json({ error: 'Unknown section' }, 404);
    await content.remove(key);
    return c.body(null, 204);
  });

  return r;
}
