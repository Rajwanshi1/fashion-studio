-- Session-level analytics: per-event client timestamps (clamped server-side),
-- the request IP (same-person-on-another-device hint; never the User-Agent),
-- and a server-stamped order link for the unspoofable 'order_created' event.
ALTER TABLE events
  ADD COLUMN occurred_at timestamptz,
  ADD COLUMN ip inet,
  ADD COLUMN order_id uuid;
UPDATE events SET occurred_at = created_at;
ALTER TABLE events
  ALTER COLUMN occurred_at SET NOT NULL,
  ALTER COLUMN occurred_at SET DEFAULT now();
CREATE INDEX events_session_idx ON events (session_id, occurred_at, id);
CREATE INDEX events_visitor_idx ON events (visitor_id, created_at);
CREATE INDEX events_order_idx ON events (order_id) WHERE order_id IS NOT NULL;
