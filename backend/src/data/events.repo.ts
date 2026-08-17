import { Pool } from 'pg';

export interface NewEvent {
  eventType: string;
  visitorId: string;
  sessionId: string;
  userId: string | null;
  path: string | null;
  productId: string | null;
  device: string;
  props: object;
  /** Client-reported moment, already clamped by the service; missing = now. */
  occurredAt?: Date;
  /** First X-Forwarded-For hop; null when unknown. */
  ip?: string | null;
  /** Always null from /track — only insertServerEvent may link an order. */
  orderId?: string | null;
}

/** Server-stamped event (order_created) — never accepted from /track. */
export interface ServerEvent {
  eventType: string;
  visitorId: string;
  sessionId: string;
  userId: string | null;
  orderId: string;
  path: string | null;
  productId: string | null;
  ip: string | null;
  props: object;
}

export interface KpiAndFunnel {
  sessions: number;
  pdpSessions: number;
  cartSessions: number;
  checkoutSessions: number;
  orderSessions: number;
  orders: number;
  /** Paise. Coerced from pg's bigint-as-string. */
  revenue: number;
}

export interface TrendDay {
  /** YYYY-MM-DD */
  day: string;
  sessions: number;
  orders: number;
}

export interface TopProduct {
  productId: string;
  name: string;
  views: number;
  carts: number;
  purchased: number;
}

export interface SearchRow {
  query: string;
  searches: number;
  lastAt: string;
}

export interface SourceRow {
  source: string;
  sessions: number;
}

export interface DeviceRow {
  device: string;
  sessions: number;
}

export interface SizeRow {
  size: string;
  adds: number;
}

export interface ColorRow {
  color: string;
  adds: number;
}

/** Best signal a session reached, ranked ordered > checkout > carted > browsed. */
export type SessionOutcome = 'ordered' | 'checkout' | 'carted' | 'browsed';

export type SessionOutcomeFilter = 'all' | SessionOutcome | 'abandoned';

export interface SessionSummary {
  sessionId: string;
  visitorId: string;
  userId: string | null;
  startedAt: string;
  endedAt: string;
  durationSec: number;
  device: string;
  landingPath: string | null;
  eventCount: number;
  outcome: SessionOutcome;
  /** Carted/checkout, no order, and idle past the 30-min session window. */
  abandoned: boolean;
  orderId: string | null;
  orderNumber: string | null;
  ip: string | null;
}

export interface TimelineEvent {
  eventType: string;
  occurredAt: string;
  path: string | null;
  productId: string | null;
  productName: string | null;
  props: Record<string, unknown>;
}

export interface VisitorDetail {
  visitorId: string;
  sessions: SessionSummary[];
  /** Sessions by OTHER visitors sharing this visitor's most recent IP. */
  sameIpSessions: number;
}

export interface EventsRepo {
  insertBatch(rows: NewEvent[]): Promise<void>;
  insertServerEvent(event: ServerEvent): Promise<void>;
  kpiAndFunnel(days: number): Promise<KpiAndFunnel>;
  dailyTrend(days: number): Promise<TrendDay[]>;
  topProducts(days: number): Promise<TopProduct[]>;
  topSearches(days: number): Promise<SearchRow[]>;
  zeroSearches(days: number): Promise<SearchRow[]>;
  sources(days: number): Promise<SourceRow[]>;
  devices(days: number): Promise<DeviceRow[]>;
  sizes(days: number): Promise<SizeRow[]>;
  colors(days: number): Promise<ColorRow[]>;
  listSessions(
    days: number,
    outcome: SessionOutcomeFilter,
    page: number,
    pageSize: number,
  ): Promise<{ sessions: SessionSummary[]; total: number }>;
  sessionTimeline(sessionId: string): Promise<TimelineEvent[]>;
  visitorDetail(visitorId: string): Promise<VisitorDetail>;
}

// Shared by topSearches/zeroSearches — identical shape, the zero variant adds
// one extra predicate on props->>'results'. `props` is client-controlled
// (only size-capped, see analytics.service.ts), so the cast is guarded: a
// bare `AND jsonb_typeof(...)='number' AND (...)::int = 0` pair sits in one
// qual list, and Postgres is free to reorder/evaluate conjuncts by estimated
// cost rather than left-to-right — the cast could still run on a row the
// typeof check meant to exclude. A single CASE expression has a documented,
// guaranteed branch order (the ELSE only evaluates when WHEN is false), so
// the cast is structurally unreachable for a non-numeric 'results' value.
// An unguarded ::int on a non-numeric 'results' value (e.g. a string) would
// throw 22P02 and 500 every summary read in that window.
async function searchRows(pool: Pool, days: number, zeroOnly: boolean): Promise<SearchRow[]> {
  const zeroClause = zeroOnly
    ? `AND CASE WHEN jsonb_typeof(props->'results') = 'number' THEN (props->>'results')::int = 0 ELSE false END`
    : '';
  const { rows } = await pool.query(
    `SELECT props->>'query' AS query, COUNT(*)::int AS searches, MAX(created_at) AS last_at
     FROM events
     WHERE event_type = 'search' AND props ? 'query' ${zeroClause}
       AND created_at > now() - make_interval(days => $1)
     GROUP BY 1
     ORDER BY searches DESC
     LIMIT 20`,
    [days],
  );
  return rows.map((r) => ({ query: r.query, searches: r.searches, lastAt: r.last_at.toISOString() }));
}

/**
 * Per-session aggregation shared by listSessions and visitorDetail. Ordered
 * array_agg picks the first/last value deterministically (occurred_at with the
 * id tiebreaker), so `device` and `landing_path` come from the session's first
 * event — in practice session_start, never the late server order event.
 */
const SESSION_AGG = `
  SELECT
    session_id,
    (array_agg(visitor_id ORDER BY occurred_at, id))[1] AS visitor_id,
    (array_agg(user_id ORDER BY occurred_at DESC, id DESC) FILTER (WHERE user_id IS NOT NULL))[1] AS user_id,
    MIN(occurred_at) AS started_at,
    MAX(occurred_at) AS ended_at,
    (array_agg(device ORDER BY occurred_at, id))[1] AS device,
    (array_agg(path ORDER BY occurred_at, id) FILTER (WHERE path IS NOT NULL))[1] AS landing_path,
    COUNT(*)::int AS event_count,
    BOOL_OR(event_type IN ('order_created', 'order_placed')) AS ordered,
    BOOL_OR(event_type IN ('checkout_start', 'checkout_step', 'payment_result')) AS reached_checkout,
    BOOL_OR(event_type = 'add_to_cart') AS carted,
    (array_agg(order_id ORDER BY occurred_at DESC, id DESC) FILTER (WHERE order_id IS NOT NULL))[1] AS order_id,
    (array_agg(host(ip) ORDER BY occurred_at DESC, id DESC) FILTER (WHERE ip IS NOT NULL))[1] AS ip
  FROM events`;

const ABANDONED_SQL = `(NOT s.ordered AND (s.carted OR s.reached_checkout) AND s.ended_at < now() - interval '30 minutes')`;

// The outer SELECT over the aggregated sessions, joining the order number.
const SESSION_SELECT = `
  SELECT s.*, o.order_number, ${ABANDONED_SQL} AS abandoned`;

interface SessionAggRow {
  session_id: string;
  visitor_id: string;
  user_id: string | null;
  started_at: Date;
  ended_at: Date;
  device: string;
  landing_path: string | null;
  event_count: number;
  ordered: boolean;
  reached_checkout: boolean;
  carted: boolean;
  order_id: string | null;
  ip: string | null;
  order_number: string | null;
  abandoned: boolean;
}

function mapSession(r: SessionAggRow): SessionSummary {
  return {
    sessionId: r.session_id,
    visitorId: r.visitor_id,
    userId: r.user_id ?? null,
    startedAt: r.started_at.toISOString(),
    endedAt: r.ended_at.toISOString(),
    durationSec: Math.max(0, Math.round((r.ended_at.getTime() - r.started_at.getTime()) / 1000)),
    device: r.device,
    landingPath: r.landing_path ?? null,
    eventCount: r.event_count,
    outcome: r.ordered ? 'ordered' : r.reached_checkout ? 'checkout' : r.carted ? 'carted' : 'browsed',
    abandoned: r.abandoned,
    orderId: r.order_id ?? null,
    orderNumber: r.order_number ?? null,
    ip: r.ip ?? null,
  };
}

// WHERE fragments keyed by the schema-validated outcome filter — never
// interpolated from raw input. Ranking makes the buckets disjoint: a session
// is counted at the deepest stage it reached.
const OUTCOME_CLAUSES: Record<SessionOutcomeFilter, string> = {
  all: 'true',
  ordered: 's.ordered',
  checkout: 's.reached_checkout AND NOT s.ordered',
  carted: 's.carted AND NOT s.reached_checkout AND NOT s.ordered',
  browsed: 'NOT s.carted AND NOT s.reached_checkout AND NOT s.ordered',
  abandoned: ABANDONED_SQL,
};

export function createEventsRepo(pool: Pool): EventsRepo {
  return {
    // Single round-trip via UNNEST — one parameterized statement regardless of batch size.
    async insertBatch(rows) {
      if (rows.length === 0) return;
      await pool.query(
        `INSERT INTO events (event_type, visitor_id, session_id, user_id, path, product_id, device, props, occurred_at, ip, order_id)
         SELECT * FROM UNNEST($1::text[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::uuid[], $7::text[], $8::jsonb[], $9::timestamptz[], $10::inet[], $11::uuid[])`,
        [
          rows.map((r) => r.eventType),
          rows.map((r) => r.visitorId),
          rows.map((r) => r.sessionId),
          rows.map((r) => r.userId),
          rows.map((r) => r.path),
          rows.map((r) => r.productId),
          rows.map((r) => r.device),
          rows.map((r) => JSON.stringify(r.props)),
          rows.map((r) => r.occurredAt ?? new Date()),
          rows.map((r) => r.ip ?? null),
          rows.map((r) => r.orderId ?? null),
        ],
      );
    },

    // occurred_at, created_at and device all take their column defaults —
    // the server's clock is the source of truth for its own events.
    async insertServerEvent(event) {
      await pool.query(
        `INSERT INTO events (event_type, visitor_id, session_id, user_id, path, product_id, props, ip, order_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [
          event.eventType,
          event.visitorId,
          event.sessionId,
          event.userId,
          event.path,
          event.productId,
          JSON.stringify(event.props),
          event.ip,
          event.orderId,
        ],
      );
    },

    async kpiAndFunnel(days) {
      const { rows } = await pool.query(
        `SELECT
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'session_start')::int   AS sessions,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'product_view')::int    AS pdp_sessions,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'add_to_cart')::int     AS cart_sessions,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'checkout_start')::int  AS checkout_sessions,
           COUNT(DISTINCT session_id) FILTER (WHERE event_type = 'order_placed')::int    AS order_sessions,
           COUNT(*)                   FILTER (WHERE event_type = 'order_placed')::int    AS orders,
           COALESCE(
             SUM(CASE WHEN jsonb_typeof(props->'total') = 'number' THEN (props->>'total')::bigint END)
               FILTER (WHERE event_type = 'order_placed'),
             0
           )::bigint AS revenue
         FROM events WHERE created_at > now() - make_interval(days => $1)`,
        [days],
      );
      const row = rows[0];
      return {
        sessions: row.sessions,
        pdpSessions: row.pdp_sessions,
        cartSessions: row.cart_sessions,
        checkoutSessions: row.checkout_sessions,
        orderSessions: row.order_sessions,
        orders: row.orders,
        revenue: Number(row.revenue), // pg bigint comes back as string
      };
    },

    async dailyTrend(days) {
      // `day` is rendered to text in SQL (to_char) rather than left as a `date`
      // column: node-postgres parses `date` into a JS Date at LOCAL midnight,
      // and re-rendering with toISOString() (UTC) shifts every label back a
      // day on any server whose local timezone is ahead of UTC (e.g. IST).
      const { rows } = await pool.query(
        `SELECT to_char(d::date, 'YYYY-MM-DD') AS day, COALESCE(e.sessions,0)::int AS sessions, COALESCE(e.orders,0)::int AS orders
         FROM generate_series(date_trunc('day', now()) - make_interval(days => $1 - 1), date_trunc('day', now()), interval '1 day') d
         LEFT JOIN (
           SELECT date_trunc('day', created_at)::date AS day,
                  COUNT(DISTINCT session_id) FILTER (WHERE event_type='session_start')::int AS sessions,
                  COUNT(*) FILTER (WHERE event_type='order_placed')::int AS orders
           FROM events WHERE created_at > now() - make_interval(days => $1) GROUP BY 1
         ) e ON e.day = d::date ORDER BY d`,
        [days],
      );
      return rows.map((r) => ({
        day: r.day,
        sessions: r.sessions,
        orders: r.orders,
      }));
    },

    async topProducts(days) {
      const { rows } = await pool.query(
        `WITH views AS (
           SELECT product_id, COUNT(*)::int AS views
           FROM events
           WHERE event_type = 'product_view' AND product_id IS NOT NULL
             AND created_at > now() - make_interval(days => $1)
           GROUP BY product_id
         ),
         carts AS (
           SELECT product_id, COUNT(*)::int AS carts
           FROM events
           WHERE event_type = 'add_to_cart' AND product_id IS NOT NULL
             AND created_at > now() - make_interval(days => $1)
           GROUP BY product_id
         ),
         bought AS (
           -- props is client-controlled (only size-capped on the way in), so every
           -- cast below is guarded: the array-ness of 'items' is checked *inside*
           -- the jsonb_array_elements() argument itself (CASE WHEN ... THEN
           -- props->'items' ELSE '[]'::jsonb END) — a bare WHERE predicate next to
           -- an SRF call in the FROM clause is plan-order-dependent (Postgres may
           -- evaluate the SRF before the qual), so the guard has to live inside the
           -- argument expression to be unconditionally safe. Each item's
           -- 'productId' must be a string matching the uuid shape before we cast
           -- it, and 'qty' must be a jsonb number before we cast it (both via CASE,
           -- same reasoning). An unguarded cast on a poisoned row throws 22P02 and
           -- 500s the whole summary read for any window containing that row.
           SELECT (item->>'productId')::uuid AS product_id,
                  SUM(CASE WHEN jsonb_typeof(item->'qty') = 'number' THEN (item->>'qty')::int END) AS purchased
           FROM events,
                jsonb_array_elements(
                  CASE WHEN jsonb_typeof(props->'items') = 'array' THEN props->'items' ELSE '[]'::jsonb END
                ) item
           WHERE event_type = 'order_placed'
             AND created_at > now() - make_interval(days => $1)
             AND jsonb_typeof(item->'productId') = 'string'
             AND item->>'productId' ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
           GROUP BY 1
         ),
         ids AS (
           SELECT product_id FROM views
           UNION
           SELECT product_id FROM carts
           UNION
           SELECT product_id FROM bought
         )
         SELECT ids.product_id AS product_id,
                COALESCE(p.name, '(removed product)') AS name,
                COALESCE(views.views, 0)::int AS views,
                COALESCE(carts.carts, 0)::int AS carts,
                COALESCE(bought.purchased, 0)::int AS purchased
         FROM ids
         LEFT JOIN views ON views.product_id = ids.product_id
         LEFT JOIN carts ON carts.product_id = ids.product_id
         LEFT JOIN bought ON bought.product_id = ids.product_id
         LEFT JOIN products p ON p.id = ids.product_id
         ORDER BY views DESC, carts DESC
         LIMIT 10`,
        [days],
      );
      return rows.map((r) => ({
        productId: r.product_id,
        name: r.name,
        views: r.views,
        carts: r.carts,
        purchased: r.purchased,
      }));
    },

    topSearches: (days) => searchRows(pool, days, false),
    zeroSearches: (days) => searchRows(pool, days, true),

    async sources(days) {
      const { rows } = await pool.query(
        `SELECT
           COALESCE(
             NULLIF(props->>'utmSource',''),
             CASE WHEN COALESCE(props->>'referrer','')='' THEN 'direct'
                  ELSE substring(props->>'referrer' from '^https?://([^/]+)') END,
             'direct'
           ) AS source,
           COUNT(DISTINCT session_id)::int AS sessions
         FROM events
         WHERE event_type = 'session_start' AND created_at > now() - make_interval(days => $1)
         GROUP BY 1
         ORDER BY sessions DESC
         LIMIT 20`,
        [days],
      );
      return rows.map((r) => ({ source: r.source, sessions: r.sessions }));
    },

    async devices(days) {
      const { rows } = await pool.query(
        `SELECT device, COUNT(DISTINCT session_id)::int AS sessions
         FROM events
         WHERE event_type = 'session_start' AND created_at > now() - make_interval(days => $1)
         GROUP BY 1
         ORDER BY sessions DESC`,
        [days],
      );
      return rows.map((r) => ({ device: r.device, sessions: r.sessions }));
    },

    async sizes(days) {
      const { rows } = await pool.query(
        `SELECT props->>'size' AS size, COUNT(*)::int AS adds
         FROM events
         WHERE event_type = 'add_to_cart' AND props ? 'size'
           AND created_at > now() - make_interval(days => $1)
         GROUP BY 1
         ORDER BY adds DESC`,
        [days],
      );
      return rows.map((r) => ({ size: r.size, adds: r.adds }));
    },

    async colors(days) {
      const { rows } = await pool.query(
        `SELECT props->>'color' AS color, COUNT(*)::int AS adds
         FROM events
         WHERE event_type = 'add_to_cart' AND props ? 'color'
           AND created_at > now() - make_interval(days => $1)
         GROUP BY 1
         ORDER BY adds DESC`,
        [days],
      );
      return rows.map((r) => ({ color: r.color, adds: r.adds }));
    },

    async listSessions(days, outcome, page, pageSize) {
      // COUNT(*) OVER () rides along after the outcome filter but before
      // LIMIT — one round-trip for both the page and the total.
      const { rows } = await pool.query(
        `WITH sessions AS (
           ${SESSION_AGG}
           WHERE created_at > now() - make_interval(days => $1)
           GROUP BY session_id
         )
         ${SESSION_SELECT}, COUNT(*) OVER ()::int AS total
         FROM sessions s
         LEFT JOIN orders o ON o.id = s.order_id
         WHERE ${OUTCOME_CLAUSES[outcome]}
         ORDER BY s.started_at DESC, s.session_id
         LIMIT $2 OFFSET $3`,
        [days, pageSize, (page - 1) * pageSize],
      );
      return { sessions: rows.map(mapSession), total: rows[0]?.total ?? 0 };
    },

    async sessionTimeline(sessionId) {
      const { rows } = await pool.query(
        `SELECT e.event_type, e.occurred_at, e.path, e.product_id, p.name AS product_name, e.props
         FROM events e
         LEFT JOIN products p ON p.id = e.product_id
         WHERE e.session_id = $1
         ORDER BY e.occurred_at, e.id
         LIMIT 1000`,
        [sessionId],
      );
      return rows.map((r) => ({
        eventType: r.event_type,
        occurredAt: r.occurred_at.toISOString(),
        path: r.path,
        productId: r.product_id,
        productName: r.product_name,
        props: r.props,
      }));
    },

    async visitorDetail(visitorId) {
      const [sessions, sameIp] = await Promise.all([
        pool.query(
          `WITH sessions AS (
             ${SESSION_AGG}
             WHERE visitor_id = $1
             GROUP BY session_id
           )
           ${SESSION_SELECT}
           FROM sessions s
           LEFT JOIN orders o ON o.id = s.order_id
           ORDER BY s.started_at DESC, s.session_id
           LIMIT 100`,
          [visitorId],
        ),
        // Sessions by OTHER visitors from this visitor's most recent IP —
        // the "same person on another device" hint. No IP on file → 0 rows.
        pool.query(
          `SELECT COUNT(DISTINCT e.session_id)::int AS same_ip
           FROM events e
           WHERE e.visitor_id <> $1
             AND e.ip = (SELECT ip FROM events
                         WHERE visitor_id = $1 AND ip IS NOT NULL
                         ORDER BY occurred_at DESC, id DESC LIMIT 1)`,
          [visitorId],
        ),
      ]);
      return {
        visitorId,
        sessions: sessions.rows.map(mapSession),
        sameIpSessions: sameIp.rows[0]?.same_ip ?? 0,
      };
    },
  };
}
