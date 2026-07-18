# Final-review fixes — report

Branch: user-analytics (worktree). No git commands run per instructions — controller commits.

## Fix 1 — CRITICAL: guard SQL casts on untrusted props (backend/src/data/events.repo.ts)

File: `backend/src/data/events.repo.ts`

- **Revenue (`kpiAndFunnel`)**: replaced `SUM((props->>'total')::bigint) FILTER (...)` with
  `SUM(CASE WHEN jsonb_typeof(props->'total')='number' THEN (props->>'total')::bigint END) FILTER (...)`,
  keeping the `COALESCE(..., 0)::bigint` wrapper and the existing `FILTER (WHERE event_type = 'order_placed')`.
- **Zero-result searches (shared `searchRows` helper)**: `zeroClause` now reads
  `AND jsonb_typeof(props->'results') = 'number' AND (props->>'results')::int = 0` instead of an
  unguarded `(props->>'results')::int = 0`. Added a comment above `searchRows` explaining why (client-controlled `props`, 22P02 on a poisoned row 500s every summary read in that window).
- **`topProducts` `bought` CTE**: added three guards before the two casts:
  - `jsonb_typeof(props->'items') = 'array'` (guards the `jsonb_array_elements(props->'items')` call in the FROM clause)
  - `jsonb_typeof(item->'productId') = 'string'` + `item->>'productId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'` (guards `(item->>'productId')::uuid`)
  - `SUM(CASE WHEN jsonb_typeof(item->'qty')='number' THEN (item->>'qty')::int END)` (guards the qty cast)
  Added a comment block explaining the guard rationale.
- **Audit of remaining queries**: `topSearches` (text-only `props->>'query'`), `sources` (`utmSource`/`referrer`, text-only, plus a regex `substring`, no cast), `devices` (no props access), `sizes`/`colors` (`props->>'size'`/`'color'`, text-only) — none of these cast a props value, so none needed guards. Confirmed by reading every query in the file.
- **`backend/test/fakes.ts`**: added a comment on `FakeEventsRepo` explaining that its JS aggregation (`Number(...)`, plain property access) can never reproduce a Postgres cast error (22P02), so any future regression in these SQL guards would NOT be caught by the fake-backed test suite — cast-guard changes must be verified against real Postgres.

### Mandatory verification — throwaway Postgres container

Approach followed task-4-report.md's precedent (a throwaway `postgres:16-alpine` container matching the project's own `docker-compose.yml` image), on a scratch port (5544) distinct from the already-running `boutique-db` (5433) so nothing live was touched.

```
$ docker run -d --name ta-fix-verify \
    -e POSTGRES_USER=boutique -e POSTGRES_PASSWORD=boutique -e POSTGRES_DB=boutique \
    -p 5544:5432 postgres:16-alpine
$ docker exec ta-fix-verify pg_isready -U boutique -d boutique
/var/run/postgresql:5432 - accepting connections

$ for f in 001_schema.sql 002_google_auth.sql 003_social_scans.sql 004_social_clicks.sql 005_events.sql; do
    PGPASSWORD=boutique psql -h localhost -p 5544 -U boutique -d boutique -v ON_ERROR_STOP=1 -f "$f"
  done
# all 5 migrations applied cleanly (CREATE TABLE / CREATE INDEX / CREATE EXTENSION / ALTER TABLE, no errors)
```

Inserted poisoned rows (plus sane control rows) directly:

```sql
-- sane order_placed (control)
INSERT INTO events (...) VALUES ('order_placed', ..., '{"total": 18400000, "items": [{"productId": "cccccccc-cccc-cccc-cccc-cccccccccccc", "qty": 2}]}'::jsonb);
-- poisoned: total is a string
INSERT INTO events (...) VALUES ('order_placed', ..., '{"total": "x"}'::jsonb);
-- poisoned: total is an object
INSERT INTO events (...) VALUES ('order_placed', ..., '{"total": {}}'::jsonb);
-- poisoned: items is a scalar, not an array
INSERT INTO events (...) VALUES ('order_placed', ..., '{"total": 5000, "items": 5}'::jsonb);
-- poisoned: items[].productId not a uuid, items[].qty not a number
INSERT INTO events (...) VALUES ('order_placed', ..., '{"total": 5000, "items": [{"productId": "nope", "qty": "x"}]}'::jsonb);
-- poisoned: search results is a string
INSERT INTO events (...) VALUES ('search', ..., '{"query": "poisoned", "results": "x"}'::jsonb);
-- sane zero-result search (control)
INSERT INTO events (...) VALUES ('search', ..., '{"query": "real zero", "results": 0}'::jsonb);
```
7 rows inserted, confirmed via `SELECT event_type, props FROM events ORDER BY id;`.

Ran the three fixed queries verbatim (copy-pasted from the patched file):

**Q1 — `kpiAndFunnel` revenue**, 30-day window:
```
 sessions | pdp_sessions | cart_sessions | checkout_sessions | order_sessions | orders | revenue
----------+--------------+---------------+-------------------+----------------+--------+----------
        0 |            0 |             0 |                 0 |              5 |      5 | 18410000
```
No error. `revenue = 18,400,000 + 5,000 + 5,000 = 18,410,000` — the two poisoned `total` rows (`"x"`, `{}`) correctly excluded from the sum (not counted, not erroring), the two sane-`total` poisoned-elsewhere rows (`items:5`, bad `items[]`) still contributed their `total:5000` since only their `items` was poisoned. Also re-ran with a 7-day window — identical result (guard is window-independent).

**Q4 — `zeroSearches`** (guarded `results` clause):
```
   query   | searches |            last_at
-----------+----------+-------------------------------
 real zero |        1 | 2026-07-18 16:54:46.832699+00
```
Only the sane zero-result row returned; the poisoned `results:"x"` row silently excluded, no error. Ran the companion `topSearches` (unaffected, text-only) too — both `poisoned` and `real zero` appear, confirming the guard is scoped to the zero-only path.

**Q3 — `topProducts` `bought` CTE** (all three guards):
```
              product_id              | purchased
--------------------------------------+-----------
 cccccccc-cccc-cccc-cccc-cccccccccccc |         2
```
No error. This is the critical empirical result: it confirms the `jsonb_typeof(props->'items')='array'` predicate in the WHERE clause *does* get evaluated/pushed down before Postgres invokes `jsonb_array_elements(props->'items')` in the FROM clause — the `items:5` scalar row and the malformed-`items[]` row were both filtered out without ever throwing "cannot extract elements from a scalar" or a uuid-cast error. Also ran the full `topProducts` query (with the `views`/`carts` CTEs and `products` join) end-to-end — same clean result, `purchased: 2` (from the one legitimate order line), `views`/`carts` both 0 (none inserted), name falls back to `'(removed product)'` since no `products` row exists in this throwaway DB.

Also spot-checked the `dailyTrend` `to_char` change: `to_char(d::date, 'YYYY-MM-DD')` returns clean `YYYY-MM-DD` text rows (`2026-07-16`, `2026-07-17`, `2026-07-18` for a 3-day `generate_series`), confirming the column now arrives as text (no JS `Date` object involved, sidestepping the timezone bug entirely).

Container torn down:
```
$ docker rm -f ta-fix-verify
ta-fix-verify
```
Confirmed via `docker ps` afterward that only the pre-existing `boutique-api`/`boutique-db` (untouched) remain.

## Fix 2 — trend day labels shift on non-UTC servers

File: `backend/src/data/events.repo.ts`, `dailyTrend`.

- SQL: `d::date AS day` → `to_char(d::date, 'YYYY-MM-DD') AS day`.
- JS: deleted the `r.day instanceof Date ? r.day.toISOString().slice(0,10) : String(r.day).slice(0,10)` branch entirely; now just `day: r.day` (already the correct text from SQL).
- Verified against real Postgres above (`to_char` output is plain `YYYY-MM-DD` text, no `Date` object to mis-render).
- `backend/test/api.test.ts`'s existing regex assertion (`body.trend[0].day` matches `/^\d{4}-\d{2}-\d{2}$/`) still passes unchanged, since `FakeEventsRepo` was never affected by this bug (pure JS date bucketing, UTC-consistent already) and the regex doesn't care about the underlying representation.

## Fix 3 — stale header comment

File: `frontend/src/lib/analytics.ts:7-8` (as numbered before the edit).

Deleted "This task wires only session_start + page_view; instrumenting the rest of the event whitelist is a later task." Rest of the header (owns visitor/session identity, batched flush, philosophy borrowed from socials/src/track.ts) left untouched — verified accurate against the current file.

## Fix 4 — `ta.session` parse-failure self-heal

File: `frontend/src/lib/analytics.ts`, `getOrRotateSession`.

Added, at the top of the existing `catch` block:
```ts
try {
  localStorage.removeItem(SESSION_KEY);
} catch {
  // Storage itself is blocked — nothing to clear, never throw.
}
```
before the existing memory-fallback logic. This means: a corrupted `ta.session` value (bad JSON, wrong shape) is cleared so the *next* read sees `null` (not unparseable JSON) and can rotate/persist a fresh session normally, instead of the JSON.parse failing forever. When storage is fully blocked (not just corrupted), the inner `removeItem` call also throws — caught by the nested try/catch, so nothing propagates (matches the file-wide "tracking must never throw" contract; verified against the pre-existing "never throws when localStorage is blocked" test, see below).

## Fix 5 — admin table count formatting

File: `admin/src/pages/Analytics.tsx`.

Added a `count(n) => n.toLocaleString('en-IN')` helper (mirroring the KPI cards' existing `.toLocaleString('en-IN')` usage) and applied it to the `views`/`carts`/`purchased` (products table), `searches` (search tables), `sessions` (sources/devices tables), and `adds` (sizes/colors tables) columns. The computed `%` columns (`pct()`-derived `v2c`/`c2b`) were left as-is, per the brief.

---

## Testing contract

### Backend (`backend/`)

```
$ npx tsc -p tsconfig.json --noEmit
(clean, no output, exit 0)

$ npx vitest run
 Test Files  10 passed (10)
      Tests  191 passed (191)
```
Same 191/191 as before the fixes (fake-backed tests are unaffected by SQL-only changes, as expected/intended — see the new `FakeEventsRepo` comment on why cast-guard regressions can't be caught this way). The cheap, real-SQL-shaped regression evidence is the throwaway-container verification above (mandatory and now documented with literal commands + output), rather than a new automated test, since a real-Postgres-backed test isn't part of this repo's existing harness (`backend/test/*` is fake-repo-only per `fakes.ts`/`api.test.ts` conventions).

### Frontend (`frontend/`)

```
$ npx vitest run src/__tests__/analytics.test.ts
 Test Files  1 passed (1)
      Tests  12 passed (12)

$ npx vitest run   (full suite)
 Test Files  15 passed (15)
      Tests  44 passed (44)

$ npx tsc --noEmit -p tsconfig.json
(clean, exit 0)
```
All pre-existing tests (including the storage-blocked test) still pass. Added one new test in `frontend/src/__tests__/analytics.test.ts`: `'self-heals a corrupted ta.session by clearing it, so the next load can persist a session again'` — seeds `localStorage['ta.session'] = 'not-valid-json{'`, calls `track('page_view')`, asserts it never throws, `Storage.prototype.removeItem` was called with `'ta.session'`, and `localStorage.getItem('ta.session')` is `null` afterward (self-healed, not left corrupted). Deliberately does **not** assert on session-rotation/`session_start` presence, because `getOrRotateSession`'s catch-path in-memory fallback (`memorySessionId`/`memorySessionTs`) is module-level state shared across this file's tests — the pre-existing "never throws when localStorage is blocked" test also touches it, so the new test was placed immediately *after* that one (not before) to avoid freshly nulling shared state the other test depends on for its own rotation assertion; both orderings were tried and this one is the non-flaky, non-regressing choice.

### Admin (`admin/`)

```
$ npx vitest run src/__tests__/analytics.test.tsx
 Test Files  1 passed (1)
      Tests  4 passed (4)

$ npx vitest run   (full suite)
 Test Files  8 passed (8)
      Tests  30 passed (30)

$ npx tsc --noEmit -p tsconfig.json
(clean, exit 0)

$ VITE_API_URL=https://api.example.com npm run build
✓ 101 modules transformed, built in 512ms
(VITE_API_URL required for production builds per an existing, unrelated guard in vite.config.ts — set only for this verification run, not a repo change)
```
Updated the RTL fixture in `admin/src/__tests__/analytics.test.tsx`: the pre-existing fixture's numeric fields (300/80/20/700/etc.) were all under 1000, so `.toLocaleString('en-IN')` wouldn't visibly change any rendered text — bumped `devices: [{ device: 'mobile', sessions: 700 }]` to `sessions: 12345` and added `expect(screen.getByText('12,345')).toBeInTheDocument()` so the new formatting is actually exercised, not just silently compatible.

## Files changed

- `backend/src/data/events.repo.ts` — Fix 1 (revenue/zeroSearches/topProducts cast guards) + Fix 2 (dailyTrend to_char).
- `backend/test/fakes.ts` — Fix 1 (FakeEventsRepo comment on cast-error blind spot).
- `frontend/src/lib/analytics.ts` — Fix 3 (stale comment) + Fix 4 (session self-heal).
- `frontend/src/__tests__/analytics.test.ts` — Fix 4 regression test.
- `admin/src/pages/Analytics.tsx` — Fix 5 (count formatting).
- `admin/src/__tests__/analytics.test.tsx` — Fix 5 fixture/assertion update.

## Concerns (superseded — see "Post-review restructure" below)

- ~~None blocking. The `topProducts` `bought` CTE guard relies on Postgres pushing the `jsonb_typeof(props->'items')='array'` predicate below the implicit lateral `jsonb_array_elements` call in the FROM clause; this was **not** assumed — it was empirically verified against real Postgres 16 with exactly the poisoned rows the brief specifies (scalar `items:5` and a malformed `items[]` element), and no error occurred. If a future Postgres version or planner change altered this pushdown behavior, the mandatory-verification step in this same report is the regression check to re-run.~~ The final reviewer correctly flagged this as plan-dependent rather than resting on documented SQL semantics — fixed below.
- No new automated real-Postgres test was added to the CI-run suite (backend tests are fake-repo-only by existing convention); the throwaway-container run above (and its re-run below) is the evidence of record for Fix 1, per the task's own instructions ("Include commands + output in your report" — done above).

---

## Post-review restructure — plan-dependent guards → structural CASE guards

The final reviewer verified the fix wave above but ruled two of the cast guards **plan-dependent** rather than resting on documented SQL semantics, and required two mechanical restructures before merge.

### Edit 1 — `topProducts` `bought` CTE (backend/src/data/events.repo.ts)

**Problem**: the array-type guard lived in the WHERE clause (`AND jsonb_typeof(props->'items') = 'array'`) sitting next to an unnest of `props->'items'` in the FROM clause. This *happened* to work in the first verification pass, but relies on Postgres pushing that qual below the SRF call before evaluating it — a query-plan behavior, not a documented guarantee. A future planner change, a different Postgres version, or a rewritten query shape could evaluate the SRF before the filter and reintroduce the 22P02.

**Fix**: moved the array-type check *into* the `jsonb_array_elements` argument itself, via a `CASE` expression whose branch order is documented SQL semantics (the ELSE branch is guaranteed to run whenever WHEN is false):

```sql
FROM events,
     jsonb_array_elements(
       CASE WHEN jsonb_typeof(props->'items') = 'array' THEN props->'items' ELSE '[]'::jsonb END
     ) item
```

A non-array `items` value now always unnests an empty array literal instead of the poisoned value — structurally safe regardless of plan shape. The now-redundant WHERE-clause prefilter was dropped (per the reviewer's "pick whichever reads cleaner" — dropping it avoids implying it's still load-bearing). The `productId`/`qty` CASE guards were already correct (CASE-based) and are unchanged.

### Edit 2 — `zeroSearches` (`searchRows` helper, backend/src/data/events.repo.ts)

**Problem**: `AND jsonb_typeof(props->'results') = 'number' AND (props->>'results')::int = 0` are two separate conjuncts in one WHERE qual list. Postgres's planner is free to reorder/evaluate conjuncts by estimated cost rather than left-to-right source order, so the cast is not guaranteed to run only after the typeof check passes — the same plan-dependence problem as Edit 1, just without an SRF involved.

**Fix**: collapsed both into a single CASE expression with a guaranteed branch order:

```sql
AND CASE WHEN jsonb_typeof(props->'results') = 'number' THEN (props->>'results')::int = 0 ELSE false END
```

The cast is now structurally reachable only inside the THEN branch, which only executes when the WHEN condition already holds.

### FakeEventsRepo comment (backend/test/fakes.ts)

Updated the wording to reflect that the guards are now structural (CASE branch semantics are part of the documented SQL standard, not something inferred from a particular query plan) while still calling out that the fake's plain-JS aggregation can never reproduce a 22P02 — cast-guard regressions still require real-Postgres verification.

### Mandatory re-verification — second throwaway Postgres container

Same recipe as the first pass, new container/port to avoid any interference with the already-running `boutique-db` (5433) or the (already-removed) first verification container:

```
$ docker run -d --name ta-fix-verify-2 \
    -e POSTGRES_USER=boutique -e POSTGRES_PASSWORD=boutique -e POSTGRES_DB=boutique \
    -p 5545:5432 postgres:16-alpine
ready after 2 tries (pg_isready)

$ for f in 001_schema.sql 002_google_auth.sql 003_social_scans.sql 004_social_clicks.sql 005_events.sql; do
    PGPASSWORD=boutique psql -h localhost -p 5545 -U boutique -d boutique -v ON_ERROR_STOP=1 -f "$f"
  done
# all 5 migrations applied cleanly, identical to the first pass
```

Inserted the exact same 7 rows as the first verification (sane order_placed control, `total:"x"`, `total:{}`, `items:5`, `items:[{"productId":"nope","qty":"x"}]`, `search results:"x"`, sane zero-result-search control) — confirmed via `SELECT event_type, props FROM events ORDER BY id;` (7 rows, byte-identical to the first pass).

Ran the two restructured queries verbatim (copy-pasted from the edited file) plus the unaffected `topSearches`/`kpiAndFunnel` controls:

```
=== Edit 2: zeroSearches (CASE-guarded, guaranteed branch order) ===
   query   | searches |            last_at
-----------+----------+-------------------------------
 real zero |        1 | 2026-07-18 17:03:24.748217+00

=== topSearches (unaffected control) ===
   query   | searches |            last_at
-----------+----------+-------------------------------
 poisoned  |        1 | 2026-07-18 17:03:24.747374+00
 real zero |        1 | 2026-07-18 17:03:24.748217+00

=== Edit 1: topProducts bought CTE (guard moved inside SRF argument) ===
              product_id              | purchased
--------------------------------------+-----------
 cccccccc-cccc-cccc-cccc-cccccccccccc |         2

=== Full topProducts query (as edited in events.repo.ts) ===
              product_id              |       name        | views | carts | purchased
--------------------------------------+-------------------+-------+-------+-----------
 cccccccc-cccc-cccc-cccc-cccccccccccc | (removed product) |     0 |     0 |         2

=== kpiAndFunnel revenue (unchanged by this wave, control re-check) ===
 revenue
----------
 18410000
```

**Identical results to the first verification pass, no errors** — confirming the restructure preserves behavior while removing the plan-dependence. Container torn down:

```
$ docker rm -f ta-fix-verify-2
ta-fix-verify-2
```
Confirmed via `docker ps` afterward that only the pre-existing `boutique-api`/`boutique-db` remain.

### Full backend suite + tsc (post-restructure)

```
$ npx tsc -p tsconfig.json --noEmit
(clean, exit 0)

$ npx vitest run
 Test Files  10 passed (10)
      Tests  191 passed (191)
```
Same 191/191 as every prior run — the restructure is SQL-only and behavior-preserving; no test changes were needed for this wave.

### Updated concerns

- None blocking. Both cast guards now rest on documented CASE-expression branch-order semantics rather than inferred query-plan behavior — no dependency on planner pushdown decisions remains anywhere in this file's cast guards.
- Unchanged from before: no new automated real-Postgres test was added to the CI-run suite (backend tests are fake-repo-only by existing convention); the two throwaway-container runs in this report are the evidence of record for Fix 1's guards.
