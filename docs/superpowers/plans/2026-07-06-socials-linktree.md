# Socials Link Page + QR Source Tracking — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development
> (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use
> checkbox (`- [ ]`) syntax for tracking.
> **Session override (Sarthak's working style):** tasks 1–3 are package-scoped and independent —
> dispatch them to parallel subagents. Subagents DO NOT run `git commit`; the orchestrator
> commits per completed task. Subagent final report under 30 lines.

**Goal:** Mobile-first link-in-bio SPA at `socials.<domain>.com` with per-placement QR codes
whose scans are source-tracked and visible in admin.

**Architecture:** New tiny `socials/` Vite+React SPA posts `?src=` to a new public backend
endpoint (`social_scans` table); admin gains a `/socials` page that generates QRs client-side
and shows scan stats. Spec: `docs/superpowers/specs/2026-07-06-socials-linktree-design.md`.

**Tech Stack:** Vite + React 18 + TS, Hono 4 + pg + zod, `qrcode` (admin only), vitest/RTL.

## Global Constraints

- Money/none here; INR formatting irrelevant. No new heavyweight deps (only `qrcode` in admin).
- Backend layering: routes → services → data (SQL only in `backend/src/data/*.repo.ts`).
- Error envelope matches existing: `{ error: { code, message } }`; zod-validate all input.
- Design language per `design-reference/DESIGN-NOTES.md`: paper `#F7F8F4`, ink `#1E2620`,
  celadon-50 `#EEF3EA`, gold `#B0894A`, hairline `rgba(30,38,32,.13)`, `--edge: 2px`,
  fonts Bodoni Moda / Cormorant Garamond italic / Jost 300. No pure black; no border radius
  beyond 2px except pill badges.
- All UI copy in the storefront's "quiet luxury" voice; wordmark exactly `Tanvi Agnihotry`.
- Reveal animations must respect `prefers-reduced-motion` and include the safety timeout
  pattern (content never stranded invisible — see frontend commit 6dfc479 lesson).
- Tests colocate with each package's existing conventions; all existing tests must stay green.

---

### Task 1: Backend — scan recording + stats (`backend/`)

**Files:**
- Create: `backend/db/migrations/003_social_scans.sql`
- Create: `backend/src/data/scans.repo.ts`
- Create: `backend/src/services/socials.service.ts`
- Create: `backend/src/routes/socials.routes.ts`
- Modify: `backend/src/app.ts` (import + `app.route('/api/socials', …)`; wire repo like others)
- Test: `backend/src/services/__tests__/socials.service.test.ts` (or repo's existing test dir
  convention — mirror where `payments.service` tests live)
- Test: route tests beside existing route tests (same file conventions)

**Interfaces:**
- Consumes: existing `db.ts` pool/query helper, existing admin-JWT middleware used by
  `admin.routes.ts` (reuse the exact same guard), existing app bootstrap in `app.ts`.
- Produces (binding for Tasks 2–3):
  - `POST /api/socials/scan` body `{source: string}` → `204` empty; `400`
    `{error:{code:'INVALID_SOURCE',message:…}}` on bad source.
  - `GET /api/socials/stats` (admin JWT) → `200 {stats: Array<{source: string; total: number;
    last7: number; last30: number; lastScanAt: string}>}` ordered total desc.

- [ ] **Step 1: Migration** — `backend/db/migrations/003_social_scans.sql`:

```sql
CREATE TABLE social_scans (
  id         bigserial PRIMARY KEY,
  source     text        NOT NULL,
  user_agent text,
  referer    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX social_scans_source_created_idx ON social_scans (source, created_at);
```

- [ ] **Step 2: Failing service tests** — normalization + validation table
  (fake repo object, same style as existing service tests):

```ts
// normalizeSource cases (write as it.each):
//  ' Store-Window '  → 'store-window'   (trim, lowercase; spaces→'-')
//  'packaging_qr'    → 'packaging_qr'
//  'a'.repeat(65)    → null (too long)
//  ''                → null
//  'café!'           → null (charset)   valid: /^[a-z0-9][a-z0-9_-]{0,63}$/ AFTER
//                                        trim/lowercase/space→hyphen collapse
// recordScan: valid → repo.insert called with (source, ua≤512, referer≤512); invalid → throws
//   ServiceError('INVALID_SOURCE') (or the codebase's existing error type — match payments/orders)
// stats: passes through repo.statsBySource()
```

- [ ] **Step 3: Run tests — expect FAIL** (`cd backend && npm test`)
- [ ] **Step 4: Implement repo** — `scans.repo.ts` exactly two functions, SQL only:

```ts
insert(source: string, userAgent: string | null, referer: string | null): Promise<void>
statsBySource(): Promise<Array<{source: string; total: number; last7: number; last30: number; lastScanAt: string}>>
-- single query:
SELECT source, COUNT(*)::int AS total,
       COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int  AS last7,
       COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS last30,
       MAX(created_at) AS last_scan_at
FROM social_scans GROUP BY source ORDER BY total DESC;
```

- [ ] **Step 5: Implement service** (`socials.service.ts`): `normalizeSource` (trim → lowercase
  → collapse whitespace runs to `-` → test regex, return normalized or null), `recordScan`,
  `stats`. Truncate ua/referer to 512 chars before insert.
- [ ] **Step 6: Route** (`socials.routes.ts`): factory taking service (match existing route
  factories). POST zod `{source: z.string().min(1).max(200)}` → 204; map INVALID_SOURCE → 400.
  GET guarded by the same admin middleware `admin.routes.ts` uses → `{stats}`. Wire in `app.ts`.
- [ ] **Step 7: Route tests via `app.request`** — scan 204 + row recorded (fake repo), scan 400
  invalid, stats 401 w/o token, stats 200 shape with admin token (mint like existing tests).
- [ ] **Step 8: Full backend suite green** (`npm test`). Report; orchestrator commits.

### Task 2: `socials/` package (NEW)

**Files:**
- Create: `socials/` — `package.json`, `vite.config.ts`, `tsconfig.json`, `index.html`,
  `src/main.tsx`, `src/App.tsx`, `src/config.ts`, `src/track.ts`, `src/styles/socials.css`,
  `src/setupTests.ts`, `src/__tests__/app.test.tsx`, `src/__tests__/track.test.ts`
- Copy tooling (vitest config, testing-library deps, tsconfig) from `frontend/` — pin the SAME
  versions frontend uses; dev server port **5175** (`server.port` in vite.config).

**Interfaces:**
- Consumes: Task 1's `POST /api/socials/scan` contract; `import.meta.env.VITE_API_URL`
  (default `http://localhost:3001`).
- Produces: the public page QRs point at — `/{?src=<source>}`.

- [ ] **Step 1: Scaffold** package.json (name `socials`, scripts dev/build/preview/test
  mirroring frontend), index.html with Google Fonts link identical to frontend's
  (Bodoni Moda / Cormorant Garamond / Jost) + `<title>Tanvi Agnihotry — Connect</title>`
  + meta description + `theme-color #1E2620`.
- [ ] **Step 2: `src/config.ts`** — single source of page content:

```ts
export const SOCIALS = {
  wordmark: 'Tanvi Agnihotry',
  tagline: 'Indo-Western couture · Made to order in Mumbai',
  links: [
    { label: 'Explore the Collection', sub: 'tanviagnihotry.com', href: 'https://tanviagnihotry.com' },
    { label: 'Instagram', sub: '@tanviagnihotry', href: 'https://instagram.com/tanviagnihotry' },
    { label: 'WhatsApp Us', sub: '+91 90000 00000', href: 'https://wa.me/919000000000' },
    { label: 'Write to Us', sub: 'care@tanviagnihotry.com', href: 'mailto:care@tanviagnihotry.com' },
    { label: 'Call the Atelier', sub: '+91 90000 00000', href: 'tel:+919000000000' },
    { label: 'Book an Appointment', sub: 'Complimentary consultation', href: 'https://tanviagnihotry.com/contact' },
  ],
  studio: ['Apt 4, Verdant House', 'Altamount Road, Mumbai 400026', 'By appointment only'],
  hours: 'Monday – Saturday · 11am – 7pm IST',
} as const;
// PLACEHOLDERS: domain, Instagram handle, phone — see TODO-THIRD-PARTY.md §8
```

- [ ] **Step 3: Failing track tests** — jsdom, mock fetch:

```ts
// ?src=Store-Window → POST /api/socials/scan {source:'Store-Window'} (server normalizes),
//   keepalive:true, then history.replaceState leaves pathname with no src/utm_source params
// no param → no fetch
// second call same session (sessionStorage 'ta-scan-logged' set) → no fetch
// fetch rejects → no throw
```

- [ ] **Step 4: `src/track.ts`** — `export function trackScan(): void`; module-level `let sent`
  guard + `sessionStorage.getItem('ta-scan-logged')`; reads `src` ?? `utm_source`;
  fire-and-forget `fetch(…, {method:'POST', headers:{'content-type':'application/json'},
  body: JSON.stringify({source}), keepalive: true}).catch(()=>{})`; sets sessionStorage;
  `history.replaceState` with src/utm_source removed. Call once from `main.tsx`.
- [ ] **Step 5: Page + CSS** — `App.tsx`: centered column `max-width 430px`; wordmark (Bodoni,
  clamp 1.9–2.4rem, letter-spacing .08em), Cormorant italic tagline, then link cards from
  config (`<a class="lk">` full-width: white surface, hairline border, 2px edge, padding
  1.05rem 1.25rem; label Jost .78rem uppercase tracking .2em; sub Cormorant italic muted;
  hover/focus-visible: gold border + label→gold + translateY(-1px); arrow `→` slides 4px).
  Below: celadon-50 block with The Studio address + hours (tiny caps headings, gold rule).
  Footer strip: ink bg, `© 2026 Tanvi Agnihotry` gold-soft .65rem caps. Rise-in reveal
  (26px, 90ms stagger) with reduced-motion guard + 1.5s safety timeout adding a
  `.revealed-all` fallback class on `<html>`. Page tests: renders all 6 links with hrefs
  from config; studio block visible.
- [ ] **Step 6: Suite green + build passes** (`npm test && npm run build`). Verify mobile-first:
  no horizontal scroll at 360px (layout is single column; assert via CSS review, not test).
- [ ] **Step 7: Report; orchestrator commits.**

### Task 3: Admin — `/socials` QR + stats page (`admin/`)

**Files:**
- Create: `admin/src/pages/Socials.tsx`
- Modify: `admin/src/App.tsx` (route `/socials` inside auth guard) + nav component (link
  "Socials" after Users — find nav where Users was added in commit 27e5906)
- Modify: `admin/package.json` (add `qrcode` + `@types/qrcode`)
- Test: `admin/src/__tests__/socials.test.tsx`

**Interfaces:**
- Consumes: `GET /api/socials/stats` contract from Task 1 (mock in tests); admin fetch helper
  in `admin/src/lib` (reuse existing authorized-fetch util); `import.meta.env.VITE_SOCIALS_URL`
  default `https://socials.tanviagnihotry.com`.
- Produces: nothing downstream.

- [ ] **Step 1: Failing RTL test** — mock stats fetch `{stats:[{source:'store-window',total:42,
  last7:5,last30:12,lastScanAt:'2026-07-01T10:00:00Z'}]}`: table shows `store-window` and 42;
  typing `Store Window!` in source input shows slug preview `store-window` and an
  `<img alt="QR code for store-window">` whose src starts `data:image/png`. Mock `qrcode`
  module (`toDataURL: async () => 'data:image/png;base64,x'`) to keep jsdom happy.
- [ ] **Step 2: Implement page** — two panels matching admin's existing card style:
  1. *Create a QR* — base URL input (prefill `VITE_SOCIALS_URL`), source input, live slug
     (same normalization as backend: trim/lowercase/spaces→`-`, strip invalid chars), target
     URL preview `${base}/?src=${slug}`, QR via `QRCode.toDataURL(url, {width: 512, margin: 2,
     color: {dark: '#1E2620', light: '#FFFFFF'}})` rendered in `<img>`; buttons Download PNG
     (anchor download `ta-qr-${slug}.png`) + Copy URL (`navigator.clipboard`).
  2. *Scans by source* — table source/total/last 7/last 30/last scan (en-IN date), empty state
     "No scans yet — print a QR and place it."; loading + error states per existing pages.
- [ ] **Step 3: Wire route + nav; suite green** (`cd admin && npm test`). Report; orchestrator
  commits.

### Task 4: Ops + docs stitch-up (orchestrator, after 1–3 merge)

**Files:**
- Modify: `amplify.yml` (third block `appRoot: socials`, same recipe; update header comment to
  mention `VITE_SOCIALS_URL` for admin builds)
- Modify: `docker-compose.yml` (`CORS_ORIGINS` default += `http://localhost:5175`)
- Modify: `README.md` (packages table row: socials / link-in-bio page / Vite+React / 5175;
  run + test snippets)
- Modify: `TODO-THIRD-PARTY.md` (new §8: replace placeholder Instagram/phone/domain in
  `socials/src/config.ts`; add socials prod origin to `CORS_ORIGINS`; set `VITE_SOCIALS_URL`
  in Amplify admin app)

- [ ] Steps: apply the four edits → `docker compose config` parses → run all three package
  test suites once more from clean state → commit.

## Self-review

- Spec coverage: §3→Task 2, §4→Task 1, §5→Task 3, §6→Task 4, §7 assumptions embedded in
  config.ts comment + TODO §8. ✓
- No placeholders in tasks; contracts (routes, types, names) consistent across tasks
  (`trackScan`, `statsBySource`, stats JSON shape, port 5175, env names). ✓
- E2E/Playwright intentionally untouched (spec scope); existing suites must stay green. ✓
