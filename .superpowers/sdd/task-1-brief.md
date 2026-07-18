# Task 1: Backend ingest slice — migration, repo, service, POST /api/track

Part of a first-party user-behavior analytics feature. This task builds the write path: a generic `events` table and a public batched ingest endpoint. All work in `backend/`.

## Pattern templates (read these first — mirror them exactly)

- `backend/src/routes/socials.routes.ts` — route factory, zod + zValidator + zodHook, public POST returning 204, per-route admin guard style
- `backend/src/services/socials.service.ts` — pg-free service, truncation constants, best-effort semantics
- `backend/src/data/scans.repo.ts` — repo factory shape over `pg` Pool, parameterized SQL
- `backend/test/fakes.ts`, `backend/test/api.test.ts` — fake repos + route tests via `app.request`
- `backend/src/app.ts` — AppDeps, service instantiation (~line 64-68), route mounts (~line 111-126)

## 1. Migration `backend/db/migrations/005_events.sql`

```sql
CREATE TABLE events (
  id         bigserial PRIMARY KEY,
  event_type text        NOT NULL,
  visitor_id uuid        NOT NULL,
  session_id uuid        NOT NULL,
  user_id    uuid,                                   -- self-reported when logged in
  path       text,                                   -- location.pathname, truncated 512
  product_id uuid,                                   -- first-class for hot GROUP BYs
  device     text        NOT NULL DEFAULT 'desktop', -- 'mobile'|'desktop', server-derived
  props      jsonb       NOT NULL DEFAULT '{}',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX events_type_created_idx ON events (event_type, created_at);
CREATE INDEX events_created_idx ON events (created_at);
```

Deliberate choices (do not "improve"): no event_type CHECK constraint (whitelist lives in zod), no FKs (analytics must not couple to entity lifecycle), no raw user_agent column (only derived `device`), no GIN index on props, created_at is server-side only. Add a brief comment block at the top of the migration noting the full UA is deliberately discarded.

## 2. Repo `backend/src/data/events.repo.ts` (new)

`createEventsRepo(pool)` exporting type `EventsRepo`. This task needs only:

```ts
insertBatch(rows: NewEvent[]): Promise<void>
```

where `NewEvent = { eventType, visitorId, sessionId, userId: string|null, path: string|null, productId: string|null, device, props: object }`. Single round-trip via UNNEST:

```sql
INSERT INTO events (event_type, visitor_id, session_id, user_id, path, product_id, device, props)
SELECT * FROM UNNEST($1::text[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::uuid[], $7::text[], $8::jsonb[])
```

(Pass jsonb as `JSON.stringify`ed strings in the array.)

## 3. Service `backend/src/services/analytics.service.ts` (new)

pg-free, factory `createAnalyticsService({ events })`, exporting `AnalyticsService` type.

`recordBatch(batch, userAgent: string | null): Promise<void>`:
- `classifyDevice(ua)`: `ua && /Mobi|Android|iPhone|iPad|iPod/i.test(ua) ? 'mobile' : 'desktop'` (null/absent UA → desktop). One device per batch (derived once from the request header).
- Per event: truncate `path` to 512 chars (constant like socials' MAX_HEADER_LEN); props cap: if `JSON.stringify(props).length > 2048` → replace with `{}` (KEEP the event, drop only props — best-effort like socials' click handling). Missing props → `{}`.
- Calls `events.insertBatch(...)`. Throws no DomainError — no new codes, no DOMAIN_STATUS changes.

## 4. Route `backend/src/routes/analytics.routes.ts` (new)

Factory `analyticsRoutes(analytics: AnalyticsService, jwtSecret: string)` returning `Hono<AuthEnv>`. (jwtSecret is used by Task 4's admin GET; accept it now.)

```ts
export const EVENT_TYPES = [
  'session_start','page_view','product_view','add_to_cart','remove_from_cart',
  'checkout_start','checkout_step','payment_result','order_placed',
  'search','filter_apply','sort_change','wishlist_add','wishlist_remove',
  'variant_select','color_select','signup','login','newsletter_signup','contact_submit',
] as const;
```

- `eventSchema = z.object({ type: z.enum(EVENT_TYPES), path: z.string().max(512).optional(), productId: z.string().uuid().optional(), props: z.record(z.unknown()).optional() })`
- `batchSchema = z.object({ visitorId: z.string().uuid(), sessionId: z.string().uuid(), userId: z.string().uuid().nullish(), events: z.array(eventSchema).min(1).max(20) })`
- `r.post('/track', zValidator('json', batchSchema, zodHook), ...)` → `analytics.recordBatch(c.req.valid('json'), c.req.header('User-Agent') ?? null)` → `c.body(null, 204)`. Public — no auth middleware.

## 5. Wiring

- `backend/src/app.ts`: add `events: EventsRepo` to `AppDeps.repos`; `const analytics = createAnalyticsService({ events: repos.events })` beside the other services; `app.route('/api', analyticsRoutes(analytics, jwtSecret))` beside the socials mount (route paths become `/api/track`).
- `backend/src/index.ts`: `events: createEventsRepo(pool)` in the repos object.
- Rate limiting: none dedicated — the global `/api/*` 300/min limiter covers it. Do not add one.

## 6. Tests (vitest, in `backend/test/`)

- `FakeEventsRepo` in `fakes.ts`: in-memory `rows` array capturing insertBatch input. ⚠️ Adding `events` to `AppDeps.repos` breaks every existing `createApp(...)` construction in the test suite — fix them all with the fake in this task.
- New `analytics.service.test.ts`: device classification (mobile UA, desktop UA, null → desktop); path truncated at 512; props > 2048 chars stringified → stored `{}` but event kept; userId passthrough (present and absent).
- Additions to `api.test.ts` (or a new route test file matching suite conventions): POST /api/track valid batch → 204 and rows in fake with correct mapping; unknown event type → 400; batch of 21 → 400; empty events array → 400; non-uuid visitorId → 400.

## Acceptance

- `npm test` green in `backend/` (whole suite, including pre-existing tests).
- `npm run build` (or `tsc --noEmit` per package convention) clean.
- Migration file lints by eye against 003/004 style.
