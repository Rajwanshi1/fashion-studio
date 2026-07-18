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

export interface EventsRepo {
  insertBatch(rows: NewEvent[]): Promise<void>;
  kpiAndFunnel(days: number): Promise<KpiAndFunnel>;
  dailyTrend(days: number): Promise<TrendDay[]>;
  topProducts(days: number): Promise<TopProduct[]>;
  topSearches(days: number): Promise<SearchRow[]>;
  zeroSearches(days: number): Promise<SearchRow[]>;
  sources(days: number): Promise<SourceRow[]>;
  devices(days: number): Promise<DeviceRow[]>;
  sizes(days: number): Promise<SizeRow[]>;
  colors(days: number): Promise<ColorRow[]>;
}

// Shared by topSearches/zeroSearches — identical shape, the zero variant adds
// one extra predicate on props->>'results'.
async function searchRows(pool: Pool, days: number, zeroOnly: boolean): Promise<SearchRow[]> {
  const zeroClause = zeroOnly ? `AND (props->>'results')::int = 0` : '';
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

export function createEventsRepo(pool: Pool): EventsRepo {
  return {
    // Single round-trip via UNNEST — one parameterized statement regardless of batch size.
    async insertBatch(rows) {
      if (rows.length === 0) return;
      await pool.query(
        `INSERT INTO events (event_type, visitor_id, session_id, user_id, path, product_id, device, props)
         SELECT * FROM UNNEST($1::text[], $2::uuid[], $3::uuid[], $4::uuid[], $5::text[], $6::uuid[], $7::text[], $8::jsonb[])`,
        [
          rows.map((r) => r.eventType),
          rows.map((r) => r.visitorId),
          rows.map((r) => r.sessionId),
          rows.map((r) => r.userId),
          rows.map((r) => r.path),
          rows.map((r) => r.productId),
          rows.map((r) => r.device),
          rows.map((r) => JSON.stringify(r.props)),
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
           COALESCE(SUM((props->>'total')::bigint) FILTER (WHERE event_type = 'order_placed'), 0)::bigint AS revenue
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
      const { rows } = await pool.query(
        `SELECT d::date AS day, COALESCE(e.sessions,0)::int AS sessions, COALESCE(e.orders,0)::int AS orders
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
        day: r.day instanceof Date ? r.day.toISOString().slice(0, 10) : String(r.day).slice(0, 10),
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
           SELECT (item->>'productId')::uuid AS product_id, SUM((item->>'qty')::int) AS purchased
           FROM events, jsonb_array_elements(props->'items') item
           WHERE event_type = 'order_placed'
             AND created_at > now() - make_interval(days => $1)
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
  };
}
