// Admin-editable storefront content. Fixed section keys, one zod schema per
// section; the storefront merges these over its built-in defaults, so every
// field is optional — an admin save always sends the full object anyway.
import { Hono } from 'hono';
import { z } from 'zod';
import { AuthEnv, requireAdmin, requireAuth } from '../middleware/auth';
import type { ContentRepo } from '../data/content.repo';

const str = z.string().max(300);
const copy = z.string().max(1000);
const url = z.string().max(500);
const image = url.nullable();

const look = z.object({ imageUrl: image, lookNo: str, title: str, copy, ctaHref: url }).partial().strict();

export const SECTION_SCHEMAS = {
  hero: z.object({
    imageUrl: image, seasonLabel: str, eyebrow: str, title: str, titleItalic: str,
    ctaPrimary: str, ctaSecondary: str, edgeLeft: str, edgeRight: str,
  }).partial().strict(),
  featured: z.object({
    imageUrl: image, eyebrow: str, title: str, titleEm: str, copy, ctaLabel: str, ctaHref: url,
  }).partial().strict(),
  marquee: z.object({ items: z.array(str.min(1)).max(8) }).strict(),
  trust: z.object({ items: z.array(z.object({ title: str, detail: str }).strict()).length(3) }).strict(),
  lookbookCover: z.object({ imageUrl: image, masthead: str, subItems: z.array(str).max(4) }).partial().strict(),
  lookbook: z.object({ looks: z.array(look).max(7), quote: copy, quoteCite: str }).partial().strict(),
  ticker: z.object({ items: z.array(str.min(1)).max(8) }).strict(),
  footer: z.object({ blurb: copy, instagramUrl: url, pinterestUrl: url, whatsappUrl: url }).partial().strict(),
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
