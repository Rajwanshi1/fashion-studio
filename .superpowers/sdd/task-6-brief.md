# Task 6: E2E smoke + docs

Full-stack smoke of the analytics pipeline plus tracker/docs updates. Everything else is built: storefront batches events to `POST /api/track` (10s flush or pagehide sendBeacon), admin `/analytics` page renders `GET /api/analytics/summary`.

## E2E — `e2e/tests/analytics.spec.ts` (new)

Templates: `e2e/tests/storefront.spec.ts`, `e2e/tests/admin.spec.ts`, `e2e/tests/helpers.ts` (adminLogin etc.), `e2e/playwright.config.ts` (baseURL storefront :4173, ADMIN_URL :4174, workers 1, desktop project; tag `@mobile` only for mobile tests — this spec is desktop-only).

Flow:
1. Storefront: goto `/` → navigate to a collection → open a PDP → select an available size → add to bag (reuse existing helpers where they exist).
2. `await page.waitForResponse(r => r.url().includes('/api/track') && r.status() === 204)` — the 10s flush timer fires inside the 60s test timeout. (Trigger: the events queued during the journey.)
3. Admin: login (helpers), goto `/analytics`, assert Sessions KPI ≥ 1 and the visited product's name appears in the top-products table. Mind eventual consistency: events flush async — after the 204, reload/poll the analytics page (Playwright `expect.toPass` or polling assertion) rather than asserting instantly once.
4. Keep state clean per suite conventions (this suite seeds/undoes via API; analytics events don't need cleanup — verify nothing else in the suite asserts on exact analytics counts).

## Docs

- `PRODUCTION-TODO.md` item #31 ("Analytics + monitoring"): mark the storefront-web-analytics half done with a one-line description of the feature (first-party events → admin /analytics), noting uptime/log monitoring remains open. Follow the file's existing checkbox/annotation style.
- Same item or its notes: add two future refinements — data retention/pruning (events table grows unbounded; `events_created_idx` makes pruning cheap) and bot filtering (unfiltered, matches socials).
- Check `PRODUCTION-TODO.md` item #29 (privacy pages): append a note that the privacy policy must disclose first-party analytics (anonymous visitor id in localStorage) when written.
- `README.md`: only if it has a feature list/endpoint table that new endpoints obviously belong in — match existing structure; otherwise skip.

## Acceptance

- `analytics.spec.ts` passes against the locally running stack (run per README recipe: docker compose Postgres + backend + built frontend/admin previews; or the project's e2e runner if one is scripted).
- Existing e2e specs still pass (workers=1 suite — run the whole suite).
- Docs edits match existing file style.
