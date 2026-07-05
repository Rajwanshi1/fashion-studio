# E2E Verification — Playwright Suite

- **Date:** 2026-07-06
- **Stack under test:** dockerized API on `:3001` (seeded), built SPAs served via
  `vite preview` — storefront `:4173`, admin `:4174`
- **Runner:** `cd e2e && npx playwright test` (workers: 1, retries: 1)
- **Projects:** `desktop` (Desktop Chrome — all specs) and `mobile` (Pixel 7 —
  only the `@mobile`-tagged purchase journey, via the mobile project's `grep`)

## Result

**8 / 8 passed** — verified over three consecutive full runs (~15 s each).
A before/after snapshot of all 98 variant stocks across a full run diffed to
zero: the suite restores every unit of stock it consumes.

| Spec | desktop | mobile |
| --- | --- | --- |
| storefront: guest purchase journey (home → collection → PDP → bag → cart → guest checkout → Razorpay test-mode → confirmation `TA-2026-\d+` → bag resets) | pass | pass (via hamburger overlay) |
| storefront: payment failure → error state → retry → success | pass | excluded by design |
| storefront: register → order while signed in (email prefilled) → account order + status badge → wishlist add/list/remove/empty | pass | excluded by design |
| admin: dashboard cards → order `paid` → advance to `in_atelier` → captured payment → 16+ products → S-stock edit persists → restored | pass | excluded by design |

## Files

- `e2e/tests/storefront.spec.ts` — specs 1–3 (spec 1 tagged `@mobile`)
- `e2e/tests/admin.spec.ts` — spec 4; creates its own paid order through the
  public API in `beforeAll` (unique `Date.now()` email) and asserts only on it
- `e2e/tests/helpers.ts` — unique emails, checkout form filler, Razorpay modal
  helpers, admin-API stock restore, paid-order factory
- `e2e/playwright.config.ts` — added `grep: /@mobile/` to the mobile project

## Data hygiene

- Every order uses a unique `*-<Date.now()>-<rand>@example.com` email; no
  assertions on absolute counts.
- Order creation decrements variant stock in the backend, so each
  order-creating test restocks its consumed unit afterwards via
  `PATCH /api/admin/variants/:id` (matched by product name + size, or variant
  id for the API-created admin order).
- The admin product-edit test bumps Fern Pleated Tissue Gown's S stock by +7,
  verifies persistence after reload, then restores the original value via the
  admin API and re-verifies in the UI.

## Notable selector workarounds (no app code changed)

- **PDP size buttons** have no accessible group/name (`XS/S/M/L/XL` text only,
  plus a "Made to Measure" CTA sharing the `.size` class) — used
  `#sizes button.size:not(.custom):enabled` to pick the first in-stock size.
- **Cart drawer** is an `aside[aria-label="Shopping bag"]` with no heading
  role — located by aria-label.
- **Admin status select:** `getByLabel('Status')` collides with the order
  filter chip group (`aria-label="Filter by status"`); needed `exact: true`.
- **Cart line / summary totals** (`article.line`, `.price-col`, `.stotal .v`),
  home bestseller prices (`#best .price`), account order card (`.order` +
  `.badge`) and admin stat cards (`.stat`) carry no roles/labels — asserted via
  scoped CSS class locators with text expectations.
- **Delivery/payment options** in checkout are clickable `div`s, not radio
  inputs — standard delivery selected by clicking its visible label text.
- Registration page keeps both auth forms in the DOM; the register form is
  scoped with `filter({ hasText: 'Join the house' })` because "Create Account"
  names both the tab and the submit button.

No product bugs found — all flows behaved as specified.
