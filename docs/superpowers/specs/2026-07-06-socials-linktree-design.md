# Socials Link Page ("Linktree") + QR Source Tracking — Design

Date: 2026-07-06 · Status: approved-by-default (autonomous session; assumptions flagged §7)

## 1. Goal

A mobile-first link-in-bio page for Tanvi Agnihotry at `socials.<domain>.com` carrying the
website link, Instagram, WhatsApp, and contact info — plus QR codes the owner can generate
per placement (store window, packaging, visiting card…) so each scan's **source** is tracked
and visible in the admin app.

## 2. Architecture (three touch points, existing patterns only)

```
socials/  (NEW package)          backend/  (extend)                admin/  (extend)
Vite+React 18 SPA, no router     POST /api/socials/scan (public)   /socials page:
one page, brand CSS              GET  /api/socials/stats (admin)   QR generator (client-side)
?src= → POST scan, clean URL     social_scans table (migration)    + scan-stats table
```

- QR codes are generated **client-side in admin** with the `qrcode` npm package — no backend
  involvement; a QR is just the URL `https://socials.<domain>/?src=<source>` rendered as PNG.
- Rejected: third-party analytics (none configured, owner wants counts in own admin);
  page as storefront route (subdomain + tiny bundle explicitly wanted); server-generated QR.

## 3. `socials/` package

- Vite + React 18 + TypeScript, mirrors `frontend/` tooling (vitest + RTL). Dev port **5175**.
- Single page, no react-router. Content lives in `socials/src/config.ts`:
  - links: Website `https://tanviagnihotry.com`, Instagram `https://instagram.com/tanviagnihotry`,
    WhatsApp `https://wa.me/919000000000`, Email `mailto:care@tanviagnihotry.com`,
    Call `tel:+919000000000`, Book an Appointment → website `/contact`.
  - blocks: studio address (Apt 4, Verdant House, Altamount Road, Mumbai 400026 · by
    appointment only), hours (Mon–Sat · 11am–7pm IST).
- Design language per `design-reference/DESIGN-NOTES.md`: paper bg, wordmark in Bodoni Moda,
  Cormorant italic tagline, Jost body; link cards full-width, 2px edges, hairline border →
  gold on hover/active; ink footer strip. Subtle rise-in reveal with reduced-motion guard and
  the same safety-timeout pattern as the storefront (content must never stay hidden).
  Lightweight: Google Fonts + zero images; must feel instant on a phone that just scanned a QR.
- **Scan beacon** (`socials/src/track.ts`): on load, read `src` query param (fallback
  `utm_source`). If present: `fetch(API + '/api/socials/scan', {method:'POST', body:{source},
  keepalive:true})` fire-and-forget (errors swallowed), then `history.replaceState` to strip
  the param (shared/copied URLs must not inflate counts). Guards: module flag (StrictMode
  double-mount) + `sessionStorage` key (reload double-count). `VITE_API_URL` default
  `http://localhost:3001`, same convention as the other SPAs.

## 4. Backend contract (binding)

Migration `backend/db/migrations/003_social_scans.sql`:

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

Routes (`backend/src/routes/socials.routes.ts`, registered `app.route('/api/socials', …)`):

- `POST /api/socials/scan` — public, body `{ "source": string }` (zod). Service normalizes:
  trim → lowercase → must match `/^[a-z0-9][a-z0-9_-]{0,63}$/` after normalization, else 400
  `{error:{code:'INVALID_SOURCE'}}`. Stores source + `user-agent`/`referer` headers (each
  truncated to 512 chars). Returns **204**. No auth, no cookies, no PII beyond UA.
- `GET /api/socials/stats` — admin JWT (same guard as other admin routes). Returns
  `{ "stats": [ { "source": "store-window", "total": 42, "last7": 5, "last30": 12,
  "lastScanAt": "2026-07-06T…Z" } ] }` ordered by total desc. Single GROUP BY query.

Layers per house rules: `data/scans.repo.ts` (SQL only) → `services/socials.service.ts`
(validation) → route. Tests: service unit tests with fake repo + route tests via
`app.request` (scan happy/invalid/oversize, stats auth + shape) — same style as existing.

## 5. Admin: `/socials` page

- Nav entry "Socials" beside Users. Page `admin/src/pages/Socials.tsx`:
  - **QR generator**: base-URL input prefilled from `VITE_SOCIALS_URL` (default
    `https://socials.tanviagnihotry.com`) + source input (auto-slugged live). Renders QR of
    `${base}/?src=${slug}` via `qrcode` `toDataURL` (512px, ink `#1E2620` on white — QR needs
    hard contrast, skip celadon). Buttons: download PNG (`ta-qr-<source>.png`), copy URL.
  - **Scan stats table**: source / total / last 7 days / last 30 / last scan, from
    `GET /api/socials/stats`; empty state when no scans.
- One RTL test: renders stats from mocked fetch + generates a QR data-url for a typed source.

## 6. Ops

- `amplify.yml`: add third application block `appRoot: socials` (same Vite recipe).
- CORS: socials origin must be in `CORS_ORIGINS`; add `http://localhost:5175` to the
  docker-compose default and note the prod origin in TODO-THIRD-PARTY.md.
- README: add socials package row + run instructions.
- TODO-THIRD-PARTY.md: new section — replace placeholder Instagram handle, WhatsApp/phone
  number, and domain in `socials/src/config.ts` + set `VITE_SOCIALS_URL` in admin build.

## 7. Assumptions (owner was AFK — all trivially editable in `socials/src/config.ts`)

1. Domain guessed as `tanviagnihotry.com` (matches seeded emails); real domain pending
   (TODO-THIRD-PARTY §5). QR base URL is an admin-side input, so wrong guesses cost nothing.
2. Instagram handle guessed `@tanviagnihotry`; phone stays the design placeholder
   `+91 90000 00000`. Both flagged in TODO-THIRD-PARTY.md.
3. Only **scan** (page-view-with-source) tracking; per-link click tracking deliberately out
   of scope (YAGNI — not asked).
4. `POST /api/socials/scan` is public and unthrottled beyond validation — acceptable for a
   boutique's traffic; revisit if abused.
