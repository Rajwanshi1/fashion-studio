# Site Content (storefront CMS) — Design

**Date:** 2026-08-10
**Status:** Approved (scope + approach confirmed with Sarthak)

## Problem

The storefront's non-catalogue content — home hero, featured-collection section,
marquee, trust badges, lookbook, announcement ticker, footer blurb and social
links — is hardcoded in `frontend/src`. The admin can manage products but cannot
change any of this without a deploy. Social links in the footer are literally
`href="#"`.

## Goal

A "Site" section in the admin dashboard where the admin edits this content and
sees it live on the storefront immediately. Very user friendly, optimised for
mobile web (the admin mostly works from a phone).

## Decisions (confirmed)

- **Scope v1:** Home page sections, announcement bar + footer, lookbook. Static
  pages (The House, Client Care, Size Guide, Contact) are out of scope for v1.
- **Fixed slots**, not a page builder: the layout is immutable; the admin edits
  content inside each slot. Impossible to break the design.
- **Save = live.** No draft/publish state. Per-section "Reset to default"
  guards against mistakes.

## Architecture

### Storage: one KV table

```sql
-- backend/db/migrations/012_site_content.sql
CREATE TABLE site_content (
  key        TEXT PRIMARY KEY,
  value      JSONB NOT NULL,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

One row per section. No seed rows: an absent row means "use the built-in
default", and reset = `DELETE`.

### Section keys and shapes (zod-validated server-side)

| key             | shape (all fields optional strings unless noted) |
|-----------------|--------------------------------------------------|
| `hero`          | imageUrl, seasonLabel, eyebrow, title, titleItalic, ctaPrimary, ctaSecondary, edgeLeft, edgeRight |
| `featured`      | imageUrl, eyebrow, title, titleEm, copy, ctaLabel, ctaHref |
| `marquee`       | items: string[] (max 8)                          |
| `trust`         | items: {title, detail}[] (exactly 3)             |
| `lookbookCover` | imageUrl, masthead, subItems: string[] (max 4)   |
| `lookbook`      | looks: {imageUrl, lookNo, title, copy, ctaHref}[] (max 7, fixed layout slots), quote, quoteCite |
| `ticker`        | items: string[] (max 8)                          |
| `footer`        | blurb, instagramUrl, pinterestUrl, whatsappUrl   |

Payloads are tiny (well under the prod WAF's 8KB body limit) because saves are
per-section.

### API

- **Public** `GET /api/content` → `{ sections: Record<key, value> }` — only
  rows that exist. Single call, no auth, cacheable.
- **Admin** (`requireAuth` + `requireAdmin`, matching existing admin routes):
  - `PUT /api/admin/content/:key` — zod-validate body per section key, upsert.
  - `DELETE /api/admin/content/:key` — reset to default (drop row).

New `content.service.ts` + `content.repo.ts` following the existing
service/repo layering; fake repo for tests like the rest of the suite.

### Images

Reuse the existing product-image presign endpoint and admin upload helper
(`admin/src/lib/uploads.ts`, `prepareImage`). Calling the product-image presign
without `productName`/`imageBase64` (no AI naming) yields a uuid key under the
public-read `products/` prefix, so site images need **no bucket-policy, WAF, or
infra change**.

### Storefront consumption

`frontend/src/lib/content.ts(x)`: fetch `/api/content` once at app level
(context provider), expose `useSiteContent()`. Every consumer merges over
**built-in defaults extracted from the current hardcoded copy**, so:

- Empty DB → site renders exactly as today (also the graceful failure mode if
  the fetch fails).
- Components touched: `Home.tsx` (hero, featured, marquee, trust, lookbook
  cover), `Ticker.tsx`, `Footer.tsx`, `Lookbook.tsx`.

### Admin UX (mweb-first)

- New nav entry **"Site"** in `Layout.tsx` → `/site`.
- `/site`: a scrollable card list, one card per section — thumbnail (if the
  section has an image), section name, one-line preview of current copy, and a
  "Customised / Default" badge. Tap anywhere on the card to edit.
- `/site/:sectionKey`: full-screen editor per section. Patterns reused from
  ProductEdit: labelled inputs, image slot with tap-to-upload (camera roll on
  phone), list editors for marquee/ticker items (add/remove/reorder rows),
  sticky bottom save bar (Save + Cancel), "Reset to default" with confirm.
  44px+ touch targets, single-column layout at phone widths.
- Save → toast "Live on the site" and return to the card list.

## Error handling

- Storefront: content fetch failure → defaults; never a broken page.
- Admin: zod 400s surface field-level messages; uploads reuse existing
  size/type errors; optimistic-free (save then toast, standard `api<T>` error
  path shows toast on failure).

## Testing

- Backend: content service tests with a fake repo (existing style — no SQL in
  unit tests). Route tests for validation + auth gating.
- SQL migration verified against a throwaway Postgres (per project memory:
  green `npm test` never exercises repo SQL).
- Frontend: unit tests for default-merging in `useSiteContent`.
- E2E: drive admin → edit hero headline → assert it renders on storefront
  (via the `verify` skill's isolated stack).

## Out of scope (v1)

- Static-page copy (The House, Client Care, Size Guide, Contact details).
- Draft/preview workflow, revision history, per-field scheduling.
- Section add/remove/reorder.
