# Task 4: Admin read API — `GET /api/analytics/summary?days=7|30|90`

Backend read path for the analytics dashboard. `events` table, `events.repo.ts`, `analytics.service.ts`, `analytics.routes.ts` all exist (ingest slice). This task adds aggregate queries, `summary(days)`, and the admin-guarded GET route.

## Route (in existing `backend/src/routes/analytics.routes.ts`)

- `summaryQuery = z.object({ days: z.enum(['7','30','90']).default('30') })`
- `r.get('/analytics/summary', requireAuth(jwtSecret), requireAdmin, zValidator('query', summaryQuery, zodHook), ...)` → `c.json(await analytics.summary(Number(days)))`. (Router mounts at `/api` → path `/api/analytics/summary`.) Guard style: per-route, same as socials' GET /stats.

## Repo queries (add to `backend/src/data/events.repo.ts`)

All parameterized `WHERE created_at > now() - make_interval(days => $1)`. Cast counts `::int`. Use these shapes:

**Q1 kpiAndFunnel** — one scan:
```sql
SELECT
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'session_start')::int   AS sessions,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'product_view')::int   AS pdp_sessions,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'add_to_cart')::int    AS cart_sessions,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'checkout_start')::int AS checkout_sessions,
  COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'order_placed')::int   AS order_sessions,
  COUNT(*)                   FILTER (WHERE event_type = 'order_placed')::int   AS orders,
  COALESCE(SUM((props->>'total')::bigint) FILTER (WHERE event_type = 'order_placed'), 0)::bigint AS revenue
FROM events WHERE created_at > now() - make_interval(days => $1)
```
(revenue comes back as string from pg bigint — Number() it in the repo.)

**Q2 dailyTrend** — gap-filled:
```sql
SELECT d::date AS day, COALESCE(e.sessions,0)::int AS sessions, COALESCE(e.orders,0)::int AS orders
FROM generate_series(date_trunc('day', now()) - make_interval(days => $1 - 1), date_trunc('day', now()), interval '1 day') d
LEFT JOIN (
  SELECT date_trunc('day', created_at)::date AS day,
         COUNT(DISTINCT session_id) FILTER (WHERE event_type='session_start')::int AS sessions,
         COUNT(*) FILTER (WHERE event_type='order_placed')::int AS orders
  FROM events WHERE created_at > now() - make_interval(days => $1) GROUP BY 1
) e ON e.day = d::date ORDER BY d
```
Return `day` as `YYYY-MM-DD` string.

**Q3 topProducts** — CTEs views/carts (`GROUP BY product_id` on product_view / add_to_cart, `product_id IS NOT NULL`) + bought (`SELECT (item->>'productId')::uuid, SUM((item->>'qty')::int) FROM events, jsonb_array_elements(props->'items') item WHERE event_type='order_placed'`), UNION of ids, LEFT JOINs, `LEFT JOIN products p ON p.id = ids.product_id` with `COALESCE(p.name, '(removed product)') AS name`, `ORDER BY views DESC, carts DESC LIMIT 10`.

**Q4 topSearches / zeroSearches** — `GROUP BY props->>'query'` on search events, `COUNT(*)::int AS searches, MAX(created_at) AS last_at`, `ORDER BY searches DESC LIMIT 20`; zero variant adds `AND (props->>'results')::int = 0`. Guard `props ? 'query'`.

**Q5 sources** — on session_start: `COALESCE(NULLIF(props->>'utmSource',''), CASE WHEN COALESCE(props->>'referrer','')='' THEN 'direct' ELSE substring(props->>'referrer' from '^https?://([^/]+)') END, 'direct') AS source, COUNT(DISTINCT session_id)::int`, GROUP BY 1 ORDER BY sessions DESC LIMIT 20.

**Q6 devices** — `SELECT device, COUNT(DISTINCT session_id)::int AS sessions FROM events WHERE event_type='session_start' AND ... GROUP BY 1`.

**Q7 sizes / colors** — on add_to_cart: `SELECT props->>'size' AS size, COUNT(*)::int AS adds ... WHERE props ? 'size' GROUP BY 1 ORDER BY adds DESC` (same for 'color').

## Service `summary(days: number)`

`Promise.all` the repo reads, then derive (ALL zero-guarded → 0, never NaN/Infinity):
- `conversionRate = order_sessions / sessions`
- `cartAbandonmentRate = (cart_sessions - order_sessions) / cart_sessions` (clamp ≥ 0)
- `aov = revenue / orders` (integer paise, round)

Return shape (this exact contract — the admin app mirrors it):
```ts
{
  kpis: { sessions, orders, revenue, conversionRate, cartAbandonmentRate, aov },
  funnel: [{stage: 'Sessions'|'Product views'|'Added to cart'|'Checkout'|'Purchased', sessions}],  // 5 in order
  trend: [{day, sessions, orders}],
  topProducts: [{productId, name, views, carts, purchased}],
  topSearches: [{query, searches, lastAt}],
  zeroSearches: [{query, searches, lastAt}],
  sources: [{source, sessions}],
  devices: [{device, sessions}],
  sizes: [{size, adds}],
  colors: [{color, adds}],
}
```

## Tests

- `FakeEventsRepo` gains the aggregate methods returning canned data (or computing from its rows where trivial).
- Service test: rate derivations incl. zero sessions / zero carts / zero orders → 0; funnel ordering.
- Route tests: GET /api/analytics/summary → 401 without token, 403 with customer token, 200 + full shape with admin token; `?days=14` → 400; default days=30 accepted. Follow existing api.test.ts auth-token helpers.

## Acceptance

`npm test` green in `backend/`, TypeScript clean. SQL verified at least by reading against the migration's column names (integration verification happens later via e2e).
