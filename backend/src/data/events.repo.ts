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

export interface EventsRepo {
  insertBatch(rows: NewEvent[]): Promise<void>;
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
  };
}
