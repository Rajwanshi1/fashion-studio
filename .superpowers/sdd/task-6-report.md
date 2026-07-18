# Task 6 report — E2E smoke + docs

Status: **DONE**

## What I implemented

### 1. `e2e/tests/analytics.spec.ts` (new)

One desktop-only test (`storefront journey emits analytics events that surface
on the admin dashboard`):

1. Registers a `page.waitForResponse` listener for `POST /api/track` returning
   204 **before** the journey starts (the 10s flush timer arms on the very
   first tracked event — the `page_view` fired by `goto('/')` — so listening
   late could race a flush that already fired).
2. Home → "Jacket Sets" collection → PDP for **Ivy Zardozi Jacket Set**
   (deliberately a product none of the other specs touch, so its analytics
   row is unambiguous even though the whole suite shares one DB/window) →
   `selectFirstAvailableSize` → "Add to Bag" → asserts the cart drawer shows
   the product + size (reusing `cartDrawer`/`selectFirstAvailableSize` from
   `helpers.ts`).
3. Awaits the registered flush promise.
4. `adminLogin`, then polls (`expect(async () => {...}).toPass({ timeout:
   30_000, intervals: [1_000, 2_000, 5_000] })`) — inside the poll: navigate to
   `/analytics`, assert the `.stat` "Sessions" card's `.v` parses to a number
   `>= 1`, and assert exactly one row in the **Top products** table (scoped by
   filtering `table.data` for a `th` containing "Views", since that column is
   unique to the top-products table among the page's several `DataTable`s)
   contains "Ivy Zardozi Jacket Set".

No cleanup needed/added: "Add to Bag" is cart-local (no stock mutation), and
the spec never checks out, so nothing to restock — consistent with the
brief's note that this suite's cleanup convention (API-driven restock) doesn't
apply to analytics events.

### 2. Docs

**`PRODUCTION-TODO.md` #31 (Analytics + monitoring)** — added a
`**Partially done (2026-07-18):**` block (matching the existing annotation
style used at e.g. item #14): describes the shipped first-party pipeline
(≈18 event types → `POST /api/track` → admin `/analytics` KPIs/funnel/
trend/breakdowns), flags uptime/log monitoring as still open, and lists the
two requested future refinements — (1) unbounded `events` table / cheap
pruning via `events_created_idx` (verified this index exists in
`backend/db/migrations/005_events.sql:17`, on `created_at`), and (2) no bot
filtering (verified `socials.service.ts` also has no UA/bot filtering, so the
phrasing "same gap as `socials/`" is accurate). Checkbox left unchecked
(`[ ]`) — same convention as #14's "Partially done" item — so the
`10/34 done` progress counter is unaffected (still 10 `[x]` boxes).

**Item-numbering note (read this):** the brief says "item #29 (privacy
pages)". In the *current* `PRODUCTION-TODO.md` on this branch, #29 is
"Shutdown timeout + resource limits" — unrelated. The only privacy-policy
item in the file is **#7** ("Legal/compliance pages + real contact details"),
which is what the brief's description clearly matches ("privacy policy must
disclose..."). I edited **#7**, not #29, and left #29 untouched. This is
almost certainly stale numbering in the brief (written against an earlier
draft of the file) rather than a real ambiguity — the content match to #7 is
unambiguous — so I proceeded rather than blocking on it, but flagging it
explicitly since it's a deviation from the literal brief text.

Added to #7: a `**Note:**` sentence that the Privacy Policy must disclose the
first-party analytics (anonymous visitor id in `localStorage`, no cookies/
third parties, events sent to our own `/api/track`), cross-referencing #31.

**`README.md`** — left untouched. It has a package table and a deployment
walkthrough, but no feature list or endpoint table that `/api/track` /
`/api/analytics/summary` would obviously slot into (per the brief: "only if
it has a feature list/endpoint table... otherwise skip").

## Stack + suite run

Verified ports 5544/3101/4173/4174 were free before binding (isolated from
the user's main dev stack on 3001/5433), then followed `.claude/skills/verify/SKILL.md`:

```bash
# 1. Isolated Postgres
docker run -d --name analytics6-pg -e POSTGRES_USER=boutique -e POSTGRES_PASSWORD=boutique \
  -e POSTGRES_DB=boutique -p 5544:5432 postgres:16-alpine

# 2. API
cd backend && NODE_ENV=development PORT=3101 \
  DATABASE_URL=postgres://boutique:boutique@localhost:5544/boutique \
  JWT_SECRET=dev-secret-change-in-prod CORS_ORIGINS=http://localhost:4174,http://localhost:4173 \
  SEED_ON_START=true npx tsx src/index.ts
# -> curl localhost:3101/api/ready => {"status":"ready"}
# (CORS_ORIGINS needed both the admin AND frontend preview origins, since this
# spec drives both apps in one test — the skill's example only lists :4174.)

# 3. Frontend + admin preview builds
cd frontend && VITE_API_URL=http://localhost:3101 npm run build
VITE_API_URL=http://localhost:3101 ./node_modules/.bin/vite preview --port 4173 --strictPort
cd admin && VITE_API_URL=http://localhost:3101 npm run build
VITE_API_URL=http://localhost:3101 ./node_modules/.bin/vite preview --port 4174 --strictPort

# 4. e2e deps (fresh worktree, e2e/node_modules didn't exist yet)
cd e2e && npm install && npx playwright install chromium

# 5. Full suite (no --project filter, so both desktop + @mobile-tagged mobile run)
cd e2e && \
  E2E_API_URL=http://localhost:3101 \
  E2E_ADMIN_URL=http://localhost:4174 \
  E2E_BASE_URL=http://localhost:4173 \
  npx playwright test
```

**Result: 9/9 passed, 28.1s, output pristine** (no warnings/retries/flakes):

```
✓ [desktop] admin.spec.ts › dashboard renders the stat cards (594ms)
✓ [desktop] admin.spec.ts › orders: the paid order appears and can advance to In the Atelier (619ms)
✓ [desktop] admin.spec.ts › payments: the captured payment for the order is listed (589ms)
✓ [desktop] admin.spec.ts › products: 16+ pieces listed; S-size stock edit persists and is restored (831ms)
✓ [desktop] analytics.spec.ts › storefront journey emits analytics events that surface on the admin dashboard (10.7s)
✓ [desktop] storefront.spec.ts › guest purchase journey: home → collection → PDP → bag → checkout → paid @mobile (4.5s)
✓ [desktop] storefront.spec.ts › payment failure shows an error and retrying succeeds (1.8s)
✓ [desktop] storefront.spec.ts › registered customer sees their order in the account, and can manage the wishlist (3.3s)
✓ [mobile] storefront.spec.ts › guest purchase journey: home → collection → PDP → bag → checkout → paid @mobile (4.0s)

9 passed (28.1s)
```

The analytics spec's 10.7s runtime confirms it's genuinely waiting out the
10s flush timer, not short-circuiting. Ran the desktop project alone first
(8/8 green) then the full config (9/9 green) — both runs clean.

**Spot-checked the pipeline directly in Postgres** (not just trusting the DOM
assertions):

```
$ docker exec analytics6-pg psql -U boutique -d boutique -c \
  "SELECT event_type, product_id IS NOT NULL AS has_product, device FROM events
   WHERE event_type IN ('product_view') OR path LIKE '%ivy%' ORDER BY id DESC LIMIT 10;"
   event_type   | has_product | device
----------------+-------------+---------
 add_to_cart    | t           | desktop
 variant_select | t           | desktop
 product_view   | t           | desktop
 page_view      | f           | desktop
 ... (x2, one per suite run)
```

Confirms `product_id` really is attached to `product_view`/`variant_select`/
`add_to_cart` rows from the spec's journey — the admin-page assertions are
reading real aggregated pipeline output, not a stale/mocked fixture.

**Teardown:** killed the API (npm wrapper + child tsx process), both `vite
preview` processes, and `docker rm -f analytics6-pg`. Verified after: no
listeners left on 3101/4173/4174/5544, `git status --porcelain` shows only
the intended file changes (build `dist/` dirs are gitignored and don't
appear).

## Files changed

- `e2e/tests/analytics.spec.ts` — new file (see full contents in
  `.superpowers/sdd/task-6-diff.txt`, which also has the `PRODUCTION-TODO.md` diff).
- `PRODUCTION-TODO.md` — item #31 annotation, item #7 privacy note (see
  numbering caveat above).
- `README.md` — not touched (intentional, see above).
- No other files touched. No git commands run (no add/commit) per
  instructions — working tree left dirty for the controller to review/commit.

## Self-review

- **Asserts real pipeline output, not just 204s?** Yes — Sessions KPI parsed
  to a number and checked `>= 1`; product name checked against an actual
  table row scoped to the Top-products table specifically (via its unique
  "Views" column header), not just "text appears somewhere on the page". Also
  independently confirmed via direct SQL query (above) that the rows exist
  with `product_id` set, so the DOM assertions aren't accidentally passing
  against leftover state from a previous run.
- **Full suite green including pre-existing specs?** Yes, 9/9, run twice (once
  desktop-only, once full config), no retries triggered, no flakiness
  observed. Output is clean list-reporter text with no stray console
  warnings.
- **Docs edits match existing style?** Yes — followed the file's established
  `**Partially done (DATE):**` / `**Still open:**` pattern (from item #14) for
  #31, and a `**Note:**` inline addition (style already used once, at item
  #5's rate-limit note) for #7. Verified the two technical claims in the #31
  note against the actual code (`events_created_idx` exists on `created_at`;
  `socials.service.ts` has no bot/UA filtering) rather than assuming them.
- **Stack torn down cleanly?** Yes, verified via `lsof` and `docker ps` (no
  processes/containers left).

## Concerns

1. **Item-numbering mismatch (see above, not a blocker but worth the
   controller's eyes):** the brief cites "#29 (privacy pages)" but current
   #29 is unrelated ("Shutdown timeout + resource limits"); the actual
   privacy-pages item is #7. I edited #7 based on content match. If the
   brief's "#29" was meant to reference some other in-flight renumbering I
   wasn't shown, this should get a quick sanity check — but nothing in the
   current file supports a different reading.
2. The analytics spec's polling loop (`toPass` with up to 30s of retries) is
   defensive per the brief's eventual-consistency warning, but in practice
   the first attempt always passed instantly in my runs — `recordBatch` is
   `await`ed before the `/api/track` handler returns 204, so by the time the
   test sees the 204 the rows are already committed. I kept the poll/reload
   anyway since the brief explicitly asked for it and it costs nothing when
   the first attempt succeeds.
3. `e2e/node_modules` and Playwright's Chromium didn't exist in this fresh
   worktree; I ran `npm install` / `playwright install chromium` as a
   prerequisite (not a code change, nothing to review, but noting it since it
   wasn't a no-op).
