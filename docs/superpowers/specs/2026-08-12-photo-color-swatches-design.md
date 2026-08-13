# Photo colour swatches — design

## Problem

The PDP's "Colour" swatch row was decorative fiction: a hard-coded four-green
palette rendered on every product regardless of its photos, and clicking a
swatch silently wrote that invented colour onto the cart line (and into the
`color_select` analytics). The shop needs the row to show only the colours a
garment actually comes in — as evidenced by its uploaded photos — and clicking
a colour should show that colourway.

## Decisions

- **The source of truth is per-photo colour data, not pixel analysis in the
  browser.** The upload path already runs a Claude vision call
  (`nameProductImage`) that reads each photo's colour to build its SEO
  filename — it now also returns `color_name` (shopper-facing display name,
  e.g. "Cherry Pink") and `color_hex` (`#rrggbb`), which are stored per photo.
  Best-effort like the pose tag: off-shape answers become null and never block
  an upload.
- **Admin corrects the name, the hex stays AI-read.** The gallery strip gets a
  per-photo colour text input (next to the pose select) with a swatch dot.
- **PDP swatches = distinct photo colours** in gallery order (first occurrence
  wins, case-insensitive). Swatch fill: the photo's hex → keyword→family map →
  `COLOR_FAMILY_META` family swatch → neutral default. A product with no
  coloured photos falls back to one honest swatch of `product.color`; the fake
  palette is gone.
- **Clicking a swatch jumps the carousel** to that colour's first photo (the
  carousel is already controlled — no new API), updates the colour label, and
  the chosen name still snapshots onto the cart line as before.
- **Backfill by re-running the vision call**, not by parsing filename slugs:
  uuid-keyed photos (AI failures) and pasted-URL photos have no slug, and slugs
  don't delimit where the colour ends (`cherry-pink-anarkali-front`). The
  script is idempotent (`WHERE color = ''`) and costs a few rupees for a
  boutique-sized catalogue.

## Storage (migration 014)

```sql
ALTER TABLE product_images
  ADD COLUMN color text NOT NULL DEFAULT '',
  ADD COLUMN color_hex text NOT NULL DEFAULT '';
```

`''` = unknown, same convention as `pose`. Additive: the previous backend's
positional inserts keep working mid-deploy.

## API

- `ProductImage` gains `color` and `colorHex` ('' when unknown) — through the
  three type mirrors.
- Presign response (`POST /admin/uploads/product-image`) gains
  `color`/`colorHex` (null when the AI was unsure); the colour is kept even
  when the slug sanitizes away.
- Product POST/PUT `images[]` rows accept `color` (≤40 chars) and `colorHex`
  (`#rrggbb` or `''`) — same wholesale-replace semantics as before.

## Backfill runbook

```
npm run backfill:photo-colors -- --dry-run     # preview
npm run backfill:photo-colors                  # write
npm run backfill:photo-colors -- --product <slug>
```

Needs `DATABASE_URL` + `ANTHROPIC_API_KEY` (same prerequisites as
`parse:photo`); on prod, run over SSM after the deploy. Rows the model can't
read stay `''` — correct them in the admin gallery.

## Testing

- Backend: vision-call colour fields validated in code (hex regex, ≤40-char
  name, lowercase normalization); presign response carries them; gallery
  round-trip persists them. 014 verified on a throwaway Postgres, including a
  pre-014-style positional insert.
- Storefront RTL: distinct-colour swatch derivation, click → label + carousel
  jump + cart colour, no-colour fallback, keyword-map fill fallback.
- Admin RTL: upload stores the colour; ThumbStrip correction lands in the PUT.
- e2e: swatch coverage stays in RTL — the seeded DB has no product photos.

## Out of scope

- Cart line `imageUrl` switching to the chosen colour's photo (possible polish).
- Colour as a variant/stock axis — colour remains a per-photo display fact.
- Backfilling from filename slugs.
