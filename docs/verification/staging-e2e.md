# Staging E2E + API Verification

End-to-end verification of the **deployed AWS staging** stack: the API contract
script and the full Playwright suite run against the live CloudFront/ALB URLs
(not the local docker-compose stack).

- **Date:** 2026-07-06
- **AWS account:** 741868637305 · region `ap-south-1` (WAF `us-east-1`)
- **Runner:** local macOS; `scripts/verify-api.sh` + `cd e2e && npx playwright test`
  (workers: 1, retries: 1)

## Target URLs (all live behind CloudFront)

| Surface | URL |
| --- | --- |
| Storefront | https://d1qn2j2hnhvlhl.cloudfront.net |
| Admin | https://d2n8mfypcal9h4.cloudfront.net |
| Socials | https://d36dldi1h3cvhl.cloudfront.net |
| API | https://d1d2imu6irdm96.cloudfront.net |

Admin auth uses the seeded `admin@tanviagnihotry.com` with the staging password
from Secrets Manager (`fashion/staging/seed-admin-password`), injected via env —
never committed or echoed.

## Step 1 — API contract (`scripts/verify-api.sh`)

```bash
API=https://d1d2imu6irdm96.cloudfront.net \
ADMIN_PASSWORD="$(aws secretsmanager get-secret-value \
  --secret-id fashion/staging/seed-admin-password --region ap-south-1 \
  --query SecretString --output text)" \
bash scripts/verify-api.sh
```

**Result: `39 passed, 0 failed`.** Every endpoint group green against staging:

- health; catalog (categories, products, filters, sort, slug detail, 404)
- auth (register, duplicate 409, bad-password 401, admin login, `/me`, no-token 401)
- guest orders (create, email lookup, wrong-email 404, empty-items 400, stock 409)
- payments (owner-scoped 404s, checkout, confirm, idempotent confirm, order → paid)
- user orders + wishlist (list, add, list, remove)
- admin (RBAC 401/403, summary, products, orders, payments, create/update product,
  order status transition, invalid-transition 400)

### Adjustments to `scripts/verify-api.sh` (committed)

Two changes, both required to run the existing script against staging from macOS;
neither weakens any assertion:

1. **Admin creds are now env-overridable.** `ADMIN_EMAIL`/`ADMIN_PASSWORD` default
   to the local docker-compose seed (`admin@tanviagnihotry.com` /
   `TanviAdmin@2026`); staging injects the real password via `ADMIN_PASSWORD`.
   The demo customer (`aanya@example.com`) is **not** used by this script — it
   registers a fresh unique user per run — so the staging customer-password secret
   was not needed here.
2. **Brace expansion disabled (`set +B`).** macOS ships bash 3.2, which mis-parses
   nested double-quotes inside `"$(...)"` and brace-expands compact JSON bodies
   like `{"a":1,"b":2}` into comma-split fragments — breaking every POST (first run
   showed 23 spurious 400s). This is a shell artifact, not a staging defect: the
   same requests via direct `curl` returned correct codes, and the script's one
   variable-built body (`ORDER_BODY`) already passed. `set +B` is a no-op on the
   bash 4+/Linux hosts the script also targets; the script uses only `${...}`
   parameter expansion, never `{a,b}` brace expansion, so it is always safe.

## Step 2 — Full Playwright suite

```bash
cd e2e
E2E_BASE_URL=https://d1qn2j2hnhvlhl.cloudfront.net \
E2E_ADMIN_URL=https://d2n8mfypcal9h4.cloudfront.net \
E2E_API_URL=https://d1d2imu6irdm96.cloudfront.net \
E2E_ADMIN_PASSWORD=<secret> npx playwright test
```

Projects: `desktop` (Desktop Chrome — all 7 specs) and `mobile` (Pixel 7 — only the
`@mobile` guest purchase journey). 8 test executions total.

### Spec-by-spec result

| # | Spec | desktop | mobile |
| --- | --- | --- | --- |
| 1 | admin: dashboard renders the stat cards | pass | — |
| 2 | admin: paid order appears, advances to In the Atelier | pass | — |
| 3 | admin: captured payment for the order is listed | pass | — |
| 4 | admin: 16+ pieces listed; S-stock edit persists and is restored | pass | — |
| 5 | storefront: guest purchase journey (home → collection → PDP → bag → checkout → paid) `@mobile` | pass | pass |
| 6 | storefront: payment failure → error → retry → success | pass | — |
| 7 | storefront: registered customer sees order in account + wishlist add/list/remove | pass | — |

**Result: all 8 executions green.**

- **Run 1:** `7 passed, 1 flaky` (exit 0). Spec 4 failed its first attempt at the
  post-`Save Piece` wait for the "Products" heading (10s expect timeout on the cold
  CloudFront path), then passed on retry #1 in 2.1s.
- **Run 2 (after the timing fix below):** `8 passed` in 22.8s (exit 0) — clean,
  zero flakes.

### Adjustment to `e2e/tests/admin.spec.ts` (committed)

Spec 4's assertion after clicking **Save Piece** (navigation back to the products
list, which waits on an API save round-trip) was given an explicit
`{ timeout: 30_000 }`. The default 10s flaked on the cold staging save+navigate
path. This is a timing fix only — the assertion (Products heading visible) is
unchanged; nothing was weakened or skipped.

## Data hygiene

Tests mutate real staging data by design: they create orders (decrementing stock),
advance one order's status, and edit then restore a variant's stock. Every order
uses a unique `*-<Date.now()>-<rand>@example.com` email and asserts only on data it
created; the S-stock edit is restored to its original value via the admin API. No
absolute-count assertions.

## WAF / rate-limit contingencies

None triggered. No WAF 403 (`x-amzn-waf-*`) blocked any legit flow, and no auth
rate-limit 429s were hit (workers: 1 keeps the suite well under the 30/min auth
limit). No changes to `backend/src/app.ts` limiters or `infra/templates/waf.yaml`
were needed.

## Conclusion

The deployed staging stack satisfies the full API contract (39/39) and the entire
Playwright journey suite (8/8 green) across desktop and mobile. No product defects
found. The only code changes are shell-portability and test-timing fixes for
running the existing checks against real-network staging; no assertions weakened.
