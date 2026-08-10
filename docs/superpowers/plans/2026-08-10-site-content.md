# Site Content (storefront CMS) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Admin-editable storefront content (home sections, ticker, footer, lookbook) via a "Site" section in the admin dashboard — fixed slots, save-goes-live, mweb-first.

**Architecture:** One `site_content` KV table (key → JSONB), public `GET /api/content`, admin `PUT/DELETE /api/admin/content/:key` with per-section zod schemas. Storefront fetches once via a context provider and merges over built-in defaults (current hardcoded copy) so an empty DB renders identically to today. Admin gets a card-list page (`/site`) + per-section full-screen editors (`/site/:key`) reusing the presign image-upload flow.

**Tech Stack:** Hono + zod + pg (backend), React + react-router (both SPAs), vitest + testing-library, existing fakes-based backend test harness.

**Spec:** `docs/superpowers/specs/2026-08-10-site-content-design.md`

## Global Constraints

- Per-section save payloads must stay well under 8KB (prod WAF body cap; only the image-naming presign route is exempt).
- Site images reuse the product-image presign **without** `productName`/`imageBase64` (uuid key under public-read `products/` prefix). No infra/bucket/WAF changes.
- Defaults = the exact strings currently hardcoded in `frontend/src` — storefront output must be byte-identical when no content rows exist.
- Backend unit tests never touch SQL (fakes only); new SQL is verified against a throwaway Postgres.
- Follow existing patterns: repos take a `Pool`, routes take deps + `jwtSecret`, admin auth = `requireAuth(jwtSecret)` + `requireAdmin`, error envelope `{ error: string }`.
- All new admin UI must be usable one-handed on a phone: single column below 640px, ≥44px touch targets, sticky bottom save bar.

---

### Task 1: Migration + content repo + fake

**Files:**
- Create: `backend/db/migrations/012_site_content.sql`
- Create: `backend/src/data/content.repo.ts`
- Modify: `backend/test/fakes.ts` (add `FakeContentRepo`, register in `makeFakes()`)
- Modify: `backend/src/index.ts` (wire `createContentRepo(pool)` into `repos`)
- Modify: `backend/src/app.ts` (add `content: ContentRepo` to `AppDeps['repos']` — compile-only here; routes come in Task 2)

**Interfaces:**
- Produces: `ContentRepo { all(): Promise<{ key: string; value: unknown }[]>; upsert(key: string, value: unknown): Promise<void>; remove(key: string): Promise<void> }` — consumed by Task 2 routes and tests.

- [ ] **Step 1: Write the migration**

```sql
-- backend/db/migrations/012_site_content.sql
-- Admin-editable storefront content: one row per fixed section (hero, ticker,
-- footer, ...). Absent row = storefront built-in default; reset = DELETE.
CREATE TABLE site_content (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

- [ ] **Step 2: Write the repo**

```ts
// backend/src/data/content.repo.ts
import { Pool } from 'pg';

export interface ContentRow {
  key: string;
  value: unknown;
}

export interface ContentRepo {
  all(): Promise<ContentRow[]>;
  upsert(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createContentRepo(pool: Pool): ContentRepo {
  return {
    async all() {
      const { rows } = await pool.query('SELECT key, value FROM site_content');
      return rows.map((r) => ({ key: r.key, value: r.value }));
    },

    async upsert(key, value) {
      await pool.query(
        `INSERT INTO site_content (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    },

    async remove(key) {
      await pool.query('DELETE FROM site_content WHERE key = $1', [key]);
    },
  };
}
```

- [ ] **Step 3: Add the fake** — in `backend/test/fakes.ts`, import the type, add the class near the other small fakes, and register it in `makeFakes()`'s returned `repos` (mirror how `scans`/`clicks` are done; the `Fakes` interface and `makeFakes` both need the new member):

```ts
import type { ContentRepo, ContentRow } from '../src/data/content.repo';

export class FakeContentRepo implements ContentRepo {
  rows = new Map<string, unknown>();
  async all(): Promise<ContentRow[]> {
    return [...this.rows.entries()].map(([key, value]) => ({ key, value }));
  }
  async upsert(key: string, value: unknown): Promise<void> {
    this.rows.set(key, JSON.parse(JSON.stringify(value)));
  }
  async remove(key: string): Promise<void> {
    this.rows.delete(key);
  }
}
```

- [ ] **Step 4: Wire types** — `backend/src/app.ts`: add `content: ContentRepo;` to `AppDeps['repos']` (+ type import). `backend/src/index.ts`: add `content: createContentRepo(pool),` beside the other repos. Update `makeFakes()` in `fakes.ts` to include `content: new FakeContentRepo()`.

- [ ] **Step 5: Verify compile + existing suite still green**

Run: `cd backend && npx tsc --noEmit && npm test`
Expected: clean compile; all existing tests PASS (nothing consumes the repo yet).

- [ ] **Step 6: Verify the SQL on a throwaway Postgres** (project rule: fakes never exercise SQL)

```bash
docker run --rm -d --name sc-verify -e POSTGRES_PASSWORD=pg -p 5499:5432 postgres:16
sleep 3
cd backend && DATABASE_URL=postgres://postgres:pg@localhost:5499/postgres npx tsx -e "
import { Pool } from 'pg';
import { migrate } from './src/migrate';
import { createContentRepo } from './src/data/content.repo';
const pool = new Pool({ connectionString: process.env.DATABASE_URL });
const applied = await migrate(pool, 'db/migrations');
console.log('applied:', applied.length);
const repo = createContentRepo(pool);
await repo.upsert('hero', { title: 'x' });
await repo.upsert('hero', { title: 'y' });
console.log('all:', JSON.stringify(await repo.all()));
await repo.remove('hero');
console.log('after remove:', (await repo.all()).length);
await pool.end();
"
docker rm -f sc-verify
```
Expected: `all:` shows `[{"key":"hero","value":{"title":"y"}}]` (upsert overwrote), `after remove: 0`.

- [ ] **Step 7: Commit**

```bash
git add backend/db/migrations/012_site_content.sql backend/src/data/content.repo.ts backend/test/fakes.ts backend/src/index.ts backend/src/app.ts
git commit -m "feat(backend): site_content table + repo + fake"
```

---

### Task 2: Content routes (public GET, admin PUT/DELETE) + tests

**Files:**
- Create: `backend/src/routes/content.routes.ts`
- Create: `backend/test/content.test.ts`
- Modify: `backend/src/app.ts` (mount router)

**Interfaces:**
- Consumes: `ContentRepo` from Task 1.
- Produces: HTTP contract — `GET /api/content` → `200 { sections: Record<string, unknown> }`; `PUT /api/admin/content/:key` (admin JWT) → `204`; `DELETE /api/admin/content/:key` (admin JWT) → `204`; unknown key → `404 { error }`; invalid body → `400 { error }`. Section keys: `hero`, `featured`, `marquee`, `trust`, `lookbookCover`, `lookbook`, `ticker`, `footer`.

- [ ] **Step 1: Write failing route tests**

```ts
// backend/test/content.test.ts
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
    app = createApp({
      repos: f.repos,
      paymentProvider: null,
      objectStore: new FakeObjectStore(),
      jwtSecret: SECRET,
      corsOrigins: ['http://localhost'],
      runInTransaction: fakeTx,
    });
    // Mirror api.test.ts's admin/customer setup (seeded admin login + a registration).
    // Copy the exact pattern used there for obtaining `adminToken`/`customerToken`.
    ...
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
```

(The `...` in `beforeEach` is the admin/customer token bootstrap — copy it verbatim from `backend/test/api.test.ts`, which logs in the seeded admin and registers a customer. Do not invent a new mechanism.)

- [ ] **Step 2: Run tests to verify they fail**

Run: `cd backend && npx vitest run test/content.test.ts`
Expected: FAIL — 404s everywhere (`/api/content` not mounted).

- [ ] **Step 3: Write the router**

```ts
// backend/src/routes/content.routes.ts
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
```

- [ ] **Step 4: Mount in `app.ts`** — after the socials mount:

```ts
import { contentRoutes } from './routes/content.routes';
// ...
app.route('/api', contentRoutes(repos.content, jwtSecret));
```

- [ ] **Step 5: Run tests to verify they pass**

Run: `cd backend && npx vitest run test/content.test.ts && npm test`
Expected: new suite PASS, full suite PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/src/routes/content.routes.ts backend/src/app.ts backend/test/content.test.ts
git commit -m "feat(backend): public content endpoint + admin per-section save/reset"
```

---

### Task 3: Storefront content lib (types, defaults, provider, merge) + tests

**Files:**
- Create: `frontend/src/lib/content.tsx`
- Create: `frontend/src/__tests__/content.test.tsx`
- Modify: `frontend/src/App.tsx` (wrap the router in `SiteContentProvider`)

**Interfaces:**
- Consumes: `GET /api/content` (Task 2), `api.get<T>` from `frontend/src/lib/api.ts`.
- Produces: `useSiteContent(): SiteContent` hook + `DEFAULT_CONTENT: SiteContent` + `mergeContent(sections: Record<string, unknown>): SiteContent` — consumed by Tasks 4–5. `SiteContent` shape:

```ts
export interface TrustItem { title: string; detail: string }
export interface Look { imageUrl: string | null; lookNo: string; title: string; copy: string; ctaHref: string }
export interface SiteContent {
  hero: { imageUrl: string | null; seasonLabel: string; eyebrow: string; title: string; titleItalic: string; ctaPrimary: string; ctaSecondary: string; edgeLeft: string; edgeRight: string };
  featured: { imageUrl: string | null; eyebrow: string; title: string; titleEm: string; copy: string; ctaLabel: string; ctaHref: string };
  marquee: { items: string[] };
  trust: { items: TrustItem[] };
  lookbookCover: { imageUrl: string | null; masthead: string; subItems: string[] };
  lookbook: { looks: Look[]; quote: string; quoteCite: string };
  ticker: { items: string[] };
  footer: { blurb: string; instagramUrl: string; pinterestUrl: string; whatsappUrl: string };
}
```

- [ ] **Step 1: Write failing merge tests**

```tsx
// frontend/src/__tests__/content.test.tsx
import { DEFAULT_CONTENT, mergeContent } from '../lib/content';

describe('mergeContent', () => {
  it('returns defaults untouched for an empty payload', () => {
    expect(mergeContent({})).toEqual(DEFAULT_CONTENT);
  });

  it('overrides only the provided fields of a section', () => {
    const merged = mergeContent({ hero: { title: 'A New Season' } });
    expect(merged.hero.title).toBe('A New Season');
    expect(merged.hero.eyebrow).toBe(DEFAULT_CONTENT.hero.eyebrow);
  });

  it('treats empty strings as "use default"', () => {
    const merged = mergeContent({ hero: { title: '' } });
    expect(merged.hero.title).toBe(DEFAULT_CONTENT.hero.title);
  });

  it('keeps an explicit image and passes null through as default', () => {
    expect(mergeContent({ hero: { imageUrl: 'https://cdn/x.jpg' } }).hero.imageUrl).toBe('https://cdn/x.jpg');
    expect(mergeContent({ hero: { imageUrl: null } }).hero.imageUrl).toBe(DEFAULT_CONTENT.hero.imageUrl);
  });

  it('replaces string lists wholesale when non-empty', () => {
    expect(mergeContent({ ticker: { items: ['Only this'] } }).ticker.items).toEqual(['Only this']);
    expect(mergeContent({ ticker: { items: [] } }).ticker.items).toEqual(DEFAULT_CONTENT.ticker.items);
  });

  it('merges trust items and looks per index over defaults', () => {
    const merged = mergeContent({ trust: { items: [{ title: 'Custom', detail: '' }, { title: '', detail: '' }, { title: '', detail: '' }] } });
    expect(merged.trust.items[0].title).toBe('Custom');
    expect(merged.trust.items[0].detail).toBe(DEFAULT_CONTENT.trust.items[0].detail);
    expect(merged.trust.items[1]).toEqual(DEFAULT_CONTENT.trust.items[1]);
  });

  it('ignores unknown sections and junk values without throwing', () => {
    expect(mergeContent({ bogus: { x: 1 }, hero: 'not-an-object' } as never)).toEqual(DEFAULT_CONTENT);
  });
});
```

- [ ] **Step 2: Run to verify failure**

Run: `cd frontend && npx vitest run src/__tests__/content.test.tsx`
Expected: FAIL — module `../lib/content` does not exist.

- [ ] **Step 3: Implement `frontend/src/lib/content.tsx`**

Structure (write it in full — the merge rules below are the contract the tests pin):

```tsx
import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';

// ... SiteContent interfaces exactly as in "Interfaces" above ...

/** The storefront's built-in copy — MUST be copied verbatim from the current
 *  hardcoded strings in Home.tsx / Ticker.tsx / Footer.tsx / Lookbook.tsx.
 *  With no admin overrides the site renders byte-identically to today. */
export const DEFAULT_CONTENT: SiteContent = {
  hero: {
    imageUrl: null,
    seasonLabel: 'Spring / Summer 2026',
    eyebrow: 'The Verdant Edit · Indo-Western Couture',
    title: 'Tanvi Agnihotry',
    titleItalic: 'heritage, made to move.',
    ctaPrimary: 'Discover the Collection',
    ctaSecondary: 'Book an Appointment',
    edgeLeft: 'Made to Order — India',
    edgeRight: 'Vol. 01 / 24 Looks',
  },
  // ... featured, marquee, trust, lookbookCover, lookbook (all 7 looks incl.
  // captions + quote), ticker, footer — every current string, verbatim ...
};

function mergeStr(v: unknown, d: string): string {
  return typeof v === 'string' && v.trim() !== '' ? v : d;
}
function mergeImg(v: unknown, d: string | null): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : d;
}
// stringList: replace wholesale when a non-empty string[] arrives, else default.
// trust.items / lookbook.looks: merge per index over the default at that index
// (extra items beyond the defaults' length are kept as-is for looks; trust is
// always exactly 3). Unknown sections and non-object section values → ignored.

export function mergeContent(sections: Record<string, unknown>): SiteContent { /* per rules above */ }

const Ctx = createContext<SiteContent>(DEFAULT_CONTENT);

export function SiteContentProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);
  useEffect(() => {
    let cancelled = false;
    api.get<{ sections: Record<string, unknown> }>('/api/content')
      .then((data) => { if (!cancelled) setContent(mergeContent(data.sections ?? {})); })
      .catch(() => undefined); // fetch failure → defaults; never a broken page
    return () => { cancelled = true; };
  }, []);
  return <Ctx.Provider value={content}>{children}</Ctx.Provider>;
}

export function useSiteContent(): SiteContent {
  return useContext(Ctx);
}
```

- [ ] **Step 4: Wrap the app** — in `frontend/src/App.tsx`, wrap the existing providers/router with `<SiteContentProvider>` (outermost is fine; it has no dependencies).

- [ ] **Step 5: Run tests**

Run: `cd frontend && npx vitest run src/__tests__/content.test.tsx && npm test`
Expected: new suite PASS; full suite PASS (provider fetch is a no-op under mocked fetch — if any existing test surfaces an unmocked `/api/content` call, extend that test's fetch mock the same way other endpoints are mocked in `__tests__/helpers.tsx`).

- [ ] **Step 6: Commit**

```bash
git add frontend/src/lib/content.tsx frontend/src/__tests__/content.test.tsx frontend/src/App.tsx
git commit -m "feat(storefront): site content provider with built-in defaults"
```

---

### Task 4: Storefront consumes content — Home, Ticker, Footer

**Files:**
- Modify: `frontend/src/pages/Home.tsx`
- Modify: `frontend/src/components/Ticker.tsx`
- Modify: `frontend/src/components/Footer.tsx`

**Interfaces:**
- Consumes: `useSiteContent()` from Task 3.

- [ ] **Step 1: Home.tsx** — `const site = useSiteContent();` then replace the hardcoded strings/slots:
  - Hero: `<ImageSlot src={site.hero.imageUrl} label="Drop campaign image — full bleed editorial" />`; side-label → `site.hero.seasonLabel`; eyebrow → `site.hero.eyebrow`; `<h1>{site.hero.title}<span className="ital">{site.hero.titleItalic}</span></h1>`; CTA labels → `ctaPrimary`/`ctaSecondary` (hrefs stay hardcoded); hero-edge spans → `edgeLeft`/`edgeRight`.
  - Marquee: render `[...site.marquee.items, ...site.marquee.items]` mapped to `<span>` (keep the alternating `.it` class by index parity as today).
  - Featured: image src, eyebrow, `<h2>{site.featured.title} <em>{site.featured.titleEm}</em></h2>`, copy paragraph, CTA `<Link to={site.featured.ctaHref}>{site.featured.ctaLabel} <span>→</span></Link>`.
  - Lookbook cover section: `<ImageSlot src={site.lookbookCover.imageUrl} …/>`, masthead, and map `subItems` interleaved with `·` separators as today.
  - Trust: map `site.trust.items` to the three `.item` blocks.
- [ ] **Step 2: Ticker.tsx** — delete the `COPY` const; `const { items } = useSiteContent().ticker;` build the doubled track from `items` interleaved with `'·'` exactly as the current output (`[t, '·']` per item).

  ⚠️ Check the current rendering first: today `COPY` already contains the `'·'` separators. Set `DEFAULT_CONTENT.ticker.items` to the three real messages and interleave in the component, so the admin edits clean messages, and the default output matches today's DOM.
- [ ] **Step 3: Footer.tsx** — blurb paragraph → `site.footer.blurb`; socials block → render each of Instagram/Pinterest/WhatsApp as `<a href={url} target="_blank" rel="noreferrer">` when its URL is non-empty, else keep `href="#"` (default state matches today).
- [ ] **Step 4: Verify no visual/behavioral drift**

Run: `cd frontend && npm test && npx tsc --noEmit && npm run build`
Expected: all PASS/green — existing nav/home-related tests assert on the same strings, which now flow from `DEFAULT_CONTENT`.
- [ ] **Step 5: Commit**

```bash
git add frontend/src/pages/Home.tsx frontend/src/components/Ticker.tsx frontend/src/components/Footer.tsx
git commit -m "feat(storefront): home, ticker, footer read from site content"
```

---

### Task 5: Storefront consumes content — Lookbook page

**Files:**
- Modify: `frontend/src/pages/Lookbook.tsx`

**Interfaces:**
- Consumes: `useSiteContent().lookbook` and `.lookbookCover` (Task 3). `looks[0..6]` map to the page's fixed slots in order: 0 = wide spread with caption, 1–2 = duo pair, 3 = offset large with caption, 4–5 = duo pair, 6 = full bleed.

- [ ] **Step 1: Rewrite the body against content** — `const { lookbookCover, lookbook } = useSiteContent();` cover uses `lookbookCover` (same fields as Home's cover section); each `ImageSlot` gets `src={lookbook.looks[i].imageUrl}` with its current label as fallback label; captioned slots (0 and 3) render `lookNo`, `title`, `copy`, and `<Link to={ctaHref}>Shop the Look →</Link>`; the pull-quote renders `lookbook.quote` / `lookbook.quoteCite`. Defaults in Task 3 carry all current strings, so DOM output is unchanged when unset.
- [ ] **Step 2: Verify**

Run: `cd frontend && npm test && npx tsc --noEmit`
Expected: PASS.
- [ ] **Step 3: Commit**

```bash
git add frontend/src/pages/Lookbook.tsx
git commit -m "feat(storefront): lookbook reads from site content"
```

---

### Task 6: Admin content model + Site card-list page + nav

**Files:**
- Create: `admin/src/lib/siteContent.ts`
- Create: `admin/src/pages/Site.tsx`
- Modify: `admin/src/App.tsx` (routes `/site`, `/site/:key`), `admin/src/components/Layout.tsx` (nav entry), `admin/src/styles/admin.css` (card styles)
- Create: `admin/src/__tests__/site.test.tsx`

**Interfaces:**
- Consumes: `GET /api/content`, `api<T>` client, `renderApp`/`mockFetch`/`seedAdminAuth` test utils.
- Produces (consumed by Task 7):

```ts
// admin/src/lib/siteContent.ts
export type SectionKey = 'hero' | 'featured' | 'marquee' | 'trust' | 'lookbookCover' | 'lookbook' | 'ticker' | 'footer';
export type FieldType = 'text' | 'textarea' | 'image' | 'stringList' | 'trustItems' | 'looks';
export interface FieldConfig { name: string; label: string; type: FieldType; hint?: string }
export interface SectionConfig { key: SectionKey; title: string; blurb: string; fields: FieldConfig[] }
export const SECTIONS: SectionConfig[]; // ordered as on the site
export const SECTION_DEFAULTS: Record<SectionKey, Record<string, unknown>>; // same strings as frontend DEFAULT_CONTENT (kept in sync by hand — each SPA owns its types, per repo convention)
export function sectionPreview(key: SectionKey, value: Record<string, unknown>): string; // one-line summary for the card
```

- [ ] **Step 1: Write failing page test**

```tsx
// admin/src/__tests__/site.test.tsx
import { screen } from '@testing-library/react';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';

describe('site content list', () => {
  it('shows a card per section with customised/default badges', async () => {
    seedAdminAuth();
    mockFetch({ 'GET /api/content': { sections: { hero: { title: 'Custom headline' } } } });
    renderApp('/site');
    expect(await screen.findByText('Hero')).toBeInTheDocument();
    expect(screen.getByText('Announcement Bar')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
    // hero row is customised, the rest default
    expect(screen.getAllByText('Customised')).toHaveLength(1);
    expect(screen.getAllByText('Default').length).toBeGreaterThan(3);
  });
});
```

(Adapt `mockFetch`'s exact stub signature from `admin/src/test/utils.ts` — mirror how `socials.test.tsx`/`dashboard.test.tsx` stub GETs. If `renderApp` doesn't take a path, use the util's established navigation mechanism.)

- [ ] **Step 2: Run to verify failure** — `cd admin && npx vitest run src/__tests__/site.test.tsx` → FAIL (no route `/site`).

- [ ] **Step 3: Implement `siteContent.ts`** — `SECTIONS` in site order with human titles/blurbs:
  Hero ("Home · opening image & headline"), Featured ("Home · new-collection feature"), Marquee ("Home · scrolling strip"), Trust ("Home · three promises"), Lookbook Cover ("Home & lookbook cover"), Lookbook ("The 7 looks & pull-quote"), Announcement Bar ("Ticker above the nav"), Footer ("Blurb & social links").
  Field lists mirror the backend schemas one-to-one (e.g. hero: image + 8 text fields; footer: textarea + 3 url text fields with hints like "Full link, e.g. https://instagram.com/…"). `SECTION_DEFAULTS` copies the storefront strings verbatim. `sectionPreview` returns the first meaningful text field (e.g. hero → title, ticker → items joined with ' · ', footer → blurb) truncated to ~80 chars.

- [ ] **Step 4: Implement `Site.tsx`** — on mount `api<{ sections: Record<string, unknown> }>('/api/content')`; render `<h1>Site</h1>` + intro line ("What the boutique shows the world — tap a card to edit.") and a `.site-cards` list: for each `SECTIONS` entry a `<Link className="site-card" to={`/site/${key}`}>` containing an image thumb when the section's stored/default value has an `imageUrl` (else a monogram tile), the title, `sectionPreview(...)` of stored-or-default value, and a `<span className="badge">` "Customised" (stored) / "Default". Loading + error states mirror `Socials.tsx`.

- [ ] **Step 5: Wire routes + nav** — `App.tsx`: `<Route path="/site" element={<Site />} />` and `<Route path="/site/:key" element={<SiteSectionEdit />} />` (create a stub `SiteSectionEdit` returning `null` for now; Task 7 fills it). `Layout.tsx`: add `<NavLink to="/site" className={navClass}>Site</NavLink>` between Products and Orders.

- [ ] **Step 6: CSS** — in `admin.css`, add a `.site-cards` block: single-column grid, `gap: 12px`; `.site-card` = white card, 12px radius, flex row (56px square thumb, text column, badge right), min-height 64px (comfortable touch target), active state `transform: scale(.99)`; badge pill styles for `Customised` (sage fill) vs `Default` (muted outline). Follow the palette/vars already used in `admin.css`.

- [ ] **Step 7: Run tests** — `cd admin && npx vitest run src/__tests__/site.test.tsx && npm test && npx tsc --noEmit` → PASS.

- [ ] **Step 8: Commit**

```bash
git add admin/src/lib/siteContent.ts admin/src/pages/Site.tsx admin/src/App.tsx admin/src/components/Layout.tsx admin/src/styles/admin.css admin/src/__tests__/site.test.tsx
git commit -m "feat(admin): Site section — card list of editable storefront content"
```

---

### Task 7: Admin per-section editor (mweb-first) + tests

**Files:**
- Create: `admin/src/pages/SiteSectionEdit.tsx` (replace Task 6 stub)
- Modify: `admin/src/styles/admin.css` (editor + sticky save bar styles)
- Create: `admin/src/__tests__/siteSectionEdit.test.tsx`

**Interfaces:**
- Consumes: `SECTIONS`, `SECTION_DEFAULTS` (Task 6); `PUT/DELETE /api/admin/content/:key` (Task 2); `uploadProductImage(file)` from `admin/src/lib/uploads.ts` (no product name → plain uuid presign); `useToast`.

- [ ] **Step 1: Write failing editor tests**

```tsx
// admin/src/__tests__/siteSectionEdit.test.tsx
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';

describe('site section editor', () => {
  it('prefills defaults, saves the edited section, and toasts', async () => {
    seedAdminAuth();
    const calls = mockFetch({
      'GET /api/content': { sections: {} },
      'PUT /api/admin/content/hero': null, // 204
    });
    renderApp('/site/hero');
    const title = await screen.findByLabelText('Headline');
    expect(title).toHaveValue('Tanvi Agnihotry'); // default prefilled
    await userEvent.clear(title);
    await userEvent.type(title, 'The Verdant Season');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));
    await waitFor(() => expect(screen.getByText('Live on the site')).toBeInTheDocument());
    // PUT body carried the full section incl. the edit
    // (assert via the util's captured-request mechanism)
  });

  it('reset to default DELETEs the section after confirm', async () => {
    seedAdminAuth();
    mockFetch({
      'GET /api/content': { sections: { hero: { title: 'Custom' } } },
      'DELETE /api/admin/content/hero': null,
    });
    renderApp('/site/hero');
    await screen.findByLabelText('Headline');
    await userEvent.click(screen.getByRole('button', { name: 'Reset to default' }));
    await userEvent.click(screen.getByRole('button', { name: 'Yes, reset' }));
    await waitFor(() => expect(screen.queryByDisplayValue('Custom')).not.toBeInTheDocument());
  });

  it('every section key renders an editor without crashing', async () => {
    seedAdminAuth();
    mockFetch({ 'GET /api/content': { sections: {} } });
    for (const key of ['hero', 'featured', 'marquee', 'trust', 'lookbookCover', 'lookbook', 'ticker', 'footer']) {
      const { unmount } = renderApp(`/site/${key}`);
      expect(await screen.findByRole('button', { name: 'Save' })).toBeInTheDocument();
      unmount();
    }
  });
});
```

(As in Task 6, adapt stub/assertion mechanics to `admin/src/test/utils.ts` — the shapes above are the behavioral contract.)

- [ ] **Step 2: Run to verify failure** — `cd admin && npx vitest run src/__tests__/siteSectionEdit.test.tsx` → FAIL (stub renders null).

- [ ] **Step 3: Implement `SiteSectionEdit.tsx`** — one generic, schema-driven editor:
  - Resolve `config = SECTIONS.find(s => s.key === params.key)`; unknown key → redirect to `/site`.
  - Load `GET /api/content`; form state = deep-merge `SECTION_DEFAULTS[key]` ← stored value (stored wins; the admin edits *effective* content, prefilled — never blank fields).
  - Render by `FieldType`:
    - `text` → labelled `<input>` (`<label htmlFor>` — the tests use `findByLabelText`).
    - `textarea` → auto-growing `<textarea>`.
    - `image` → current image (or empty `ImageSlot`-style tile) + "Replace photo" button firing a hidden `<input type="file" accept="image/*">`; on change `uploadProductImage(file)` → set the field to `publicUrl`; busy state on the tile while uploading; "Remove photo" sets `null`.
    - `stringList` (marquee/ticker) → one row per item: `<input>` + ↑ ↓ ✕ buttons, plus "Add line" (respect max 8; hide Add at cap).
    - `trustItems` → exactly 3 fixed rows of title + detail inputs (no add/remove).
    - `looks` → 7 fixed numbered blocks, each: image field + lookNo/title/copy/ctaHref inputs; blocks 1 and 4 flagged "shown with caption" in the hint, plus quote/quoteCite inputs at the end.
  - Sticky bottom `.savebar`: Cancel (back to `/site`) + Save. Save → `api('/api/admin/content/' + key, { method: 'PUT', body: form })` → toast "Live on the site" → navigate to `/site`. Error → toast the message.
  - "Reset to default" (danger-styled, below the fields, only when the section is customised): inline confirm (two buttons, "Yes, reset" / "Keep"), then `DELETE`, reload defaults into the form.
- [ ] **Step 4: CSS (mweb-first)** — `.sec-editor { max-width: 640px }`, single column; inputs ≥44px tall, 16px font (prevents iOS zoom); `.savebar { position: sticky; bottom: 0; display: flex; gap: 8px; padding: 12px calc(12px + env(safe-area-inset-right)) calc(12px + env(safe-area-inset-bottom)) 12px; background: <canvas var>; border-top: 1px solid <line var>; }` with Save flex-growing; list-row buttons ≥44px square. Reuse existing button classes where they exist.
- [ ] **Step 5: Run** — `cd admin && npx vitest run src/__tests__/siteSectionEdit.test.tsx && npm test && npx tsc --noEmit` → PASS.
- [ ] **Step 6: Commit**

```bash
git add admin/src/pages/SiteSectionEdit.tsx admin/src/styles/admin.css admin/src/__tests__/siteSectionEdit.test.tsx admin/src/App.tsx
git commit -m "feat(admin): mobile-first per-section site content editor"
```

---

### Task 8: End-to-end verification

**Files:** none (verification only; fix-forward anything found).

- [ ] **Step 1: Full static + unit sweep**

Run: `(cd backend && npx tsc --noEmit && npm test) && (cd frontend && npx tsc --noEmit && npm test && npm run build) && (cd admin && npx tsc --noEmit && npm test && npm run build)`
Expected: everything green.

- [ ] **Step 2: Live e2e via the `verify` skill** (isolated Postgres + API + both SPAs + Playwright). Script:
  1. Storefront home renders with default copy (no rows yet).
  2. Admin login → Site → all 8 cards show "Default".
  3. Edit Hero: change headline to "The Verdant Season", save → toast, card badge flips to "Customised".
  4. Storefront home (fresh load) shows "The Verdant Season" in the hero.
  5. Edit Announcement Bar: replace items with one message → storefront ticker shows it.
  6. Footer: set an Instagram URL → storefront footer link points at it.
  7. Reset Hero → storefront back to default headline.
  8. Mobile viewport (390×844): Site list and Hero editor — no horizontal scroll, save bar visible above the keyboardless fold, all controls tappable.
- [ ] **Step 3: Commit any fixes; then run the admin e2e suite baseline-aware** (offline-orders + deliveries specs fail on main too — compare against main's baseline, only new failures count).

---

## Self-review notes

- Spec coverage: storage (T1), API (T2), storefront fallback+consumption (T3–T5), admin UX list+editor (T6–T7), images via existing presign (T7 Step 3), testing incl. throwaway-Postgres SQL check (T1 Step 6) and e2e (T8). Static pages intentionally out of scope.
- Known duplication: default strings exist in `frontend/src/lib/content.tsx` and `admin/src/lib/siteContent.ts` — accepted; each SPA owning its types is the repo's existing convention (documented in both files' comments).
- Contract consistency: section keys and field names are identical across `SECTION_SCHEMAS` (T2), `SiteContent` (T3), and `SECTIONS`/`SECTION_DEFAULTS` (T6) — reviewer should diff the three lists.
