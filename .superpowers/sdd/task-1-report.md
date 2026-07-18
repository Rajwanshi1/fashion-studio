# Task 1 Report — Backend ingest slice (events table + POST /api/track)

## What I implemented

1. **Migration** `backend/db/migrations/005_events.sql` — the `events` table, exactly the SQL given in the brief, with a 3-line comment block at the top noting the full User-Agent is deliberately discarded (only derived `device` is stored). No CHECK constraint, no FKs, no GIN index — as specified.

2. **Repo** `backend/src/data/events.repo.ts` — `createEventsRepo(pool)` / `EventsRepo` / `NewEvent`. Single `insertBatch(rows)` using the exact `UNNEST` statement from the brief, one round trip, `props` passed as `JSON.stringify`ed strings. Guards `rows.length === 0` (no-op) — not asked for explicitly, but harmless and matches the defensive style of other repos; the route path never hits it empty since zod enforces `min(1)`.

3. **Service** `backend/src/services/analytics.service.ts` — pg-free, `createAnalyticsService({ events })` / `AnalyticsService`. Exports `classifyDevice(ua)` (mirrors `normalizeSource`'s testable-helper pattern from socials) using the exact regex from the brief. `recordBatch(batch, userAgent)`:
   - Derives one `device` for the whole batch from the header.
   - Per event: truncates `path` to `MAX_PATH_LEN = 512`; missing path → `null`.
   - Per event: if `JSON.stringify(props).length > MAX_PROPS_LEN(2048)`, replaces props with `{}` but **keeps** the event (best-effort, like socials' click source handling); missing props → `{}`.
   - `userId` passthrough: `batch.userId ?? null` (present, explicit null, and absent all collapse to `null`/value correctly).
   - Calls `events.insertBatch(...)` once per `recordBatch` call. Throws nothing — no new `DomainError` codes.

4. **Route** `backend/src/routes/analytics.routes.ts` — `analyticsRoutes(analytics, jwtSecret)` returning `Hono<AuthEnv>`. Exports `EVENT_TYPES` (verbatim list) and the two zod schemas verbatim from the brief. `POST /track` is public (no auth middleware), validates with `zValidator('json', batchSchema, zodHook)`, calls `analytics.recordBatch(c.req.valid('json'), c.req.header('User-Agent') ?? null)`, returns `c.body(null, 204)`. `jwtSecret` is accepted but intentionally unused (commented why — Task 4's admin GET will need it on this same route group); `tsconfig.json` has no `noUnusedParameters`, so this compiles clean without a `void` hack.

5. **Wiring**:
   - `backend/src/app.ts`: added `events: EventsRepo` to `AppDeps.repos`; `const analytics = createAnalyticsService({ events: repos.events })` beside `socials`; `app.route('/api', analyticsRoutes(analytics, jwtSecret))` beside the socials mount → paths become `/api/track`.
   - `backend/src/index.ts`: `events: createEventsRepo(pool)` added to the repos object.
   - No rate limiter added — relies on the existing global `/api/*` 300/min limiter, per the brief.

6. **Tests**:
   - `backend/test/fakes.ts`: added `FakeEventsRepo` (in-memory `rows: NewEvent[]`, `insertBatch` pushes them), added `events` to the `Fakes` interface and `makeFakes()`. This was the only change needed to keep every existing `createApp(...)` call site compiling — both `api.test.ts` and `ready.test.ts` construct `repos` from `Fakes`/`makeFakes()`, so no call-site edits were required there.
   - `backend/test/analytics.service.test.ts` (new, 14 tests): `classifyDevice` table test (iPhone UA, Android UA, desktop UA, null → desktop); one-device-per-batch derivation; path truncation at 512 / short path unchanged / missing → null; oversized props (>2048 chars stringified) dropped to `{}` while the event is kept, and normal-size props pass through untouched, missing → `{}`; `userId` passthrough for present / absent / explicit-null; `eventType`/`visitorId`/`sessionId`/`productId` passthrough and productId defaulting; `insertBatch` called exactly once per `recordBatch` call.
   - `backend/test/api.test.ts`: new `describe('analytics')` block (7 tests) mirroring the `socials` block's style: valid batch → 204 + correct row mapping in the fake; userId/productId/props mapping; unknown event type → 400 (`{error:string}`); batch of exactly 20 accepted, 21 rejected with 400 and no partial insert; empty events array → 400; non-uuid `visitorId` → 400.

## Test commands run and results

```
npm install                              # fresh worktree, added 71 packages
npx vitest run test/analytics.service.test.ts   # 14 passed
npx vitest run test/api.test.ts                 # 63 passed (incl. new analytics block)
npm test                                        # full suite
npx tsc --noEmit -p tsconfig.json               # clean, no output
npm run build                                   # clean, no output
```

Full-suite final summary:
```
 Test Files  10 passed (10)
      Tests  181 passed (181)
```
(config, socials.service, analytics.service, orders.service, catalog.service, payments.service, ready, rate-limit, auth.service, api — all green.)

`tsc --noEmit` and `npm run build` both completed with no output/errors.

## Files changed

New:
- `backend/db/migrations/005_events.sql`
- `backend/src/data/events.repo.ts`
- `backend/src/services/analytics.service.ts`
- `backend/src/routes/analytics.routes.ts`
- `backend/test/analytics.service.test.ts`

Edited:
- `backend/src/app.ts` (AppDeps.repos.events, analytics service instantiation, route mount)
- `backend/src/index.ts` (events repo wiring)
- `backend/test/fakes.ts` (FakeEventsRepo, Fakes interface, makeFakes)
- `backend/test/api.test.ts` (new `analytics` describe block)

## Self-review findings

- **Completeness**: every brief item present — migration (verbatim SQL + required comment), repo (verbatim UNNEST SQL), service (device classification, truncation, props cap, userId passthrough), route (verbatim EVENT_TYPES/schemas, public 204), wiring in both app.ts and index.ts, tests for all listed cases including edge cases (null UA → desktop, oversized props keeps the event, empty batch rejected by zod before it ever reaches the service/repo, batch of 21 rejected while exactly 20 is accepted).
- **Quality**: naming and structure mirror the socials trio closely (`classifyDevice` echoes `normalizeSource` as an exported testable helper; `MAX_PATH_LEN`/`MAX_PROPS_LEN` echo `MAX_HEADER_LEN`; route file shape, comment style, and public-route commenting match `socials.routes.ts`). No restructuring of unrelated code.
- **Discipline**: confirmed no CHECK constraint on `event_type`, no FKs, no GIN index, no new `DomainError` codes / `DOMAIN_STATUS` entries, no dedicated rate limiter — all deliberately omitted per the brief. `insertBatch`'s empty-array early return is the one thing not explicitly requested; it's a one-line no-op guard consistent with defensive style elsewhere and is never actually exercised via the route (zod's `min(1)` prevents it), so I kept it rather than treating it as scope creep, but flagging it here for visibility.
- **Testing**: tests assert behavior (row shape, status codes, row counts) rather than implementation details; ran focused suites first, then the full suite once; output is clean (no console noise, no skipped/todo tests).

## Issues or concerns

None. No blockers, no ambiguity encountered in the brief — the exact SQL/schemas/values were used verbatim as instructed. Did not touch git (no add/commit) per instructions.
