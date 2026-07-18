-- First-party user-behavior analytics — generic event log for the storefront's
-- page/product/cart/checkout funnel. The full User-Agent string is deliberately
-- discarded; only a server-derived `device` ('mobile'|'desktop') is stored.
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
