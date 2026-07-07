-- Link-in-bio "socials" page — outbound link clicks, attributed to the QR scan
-- source (social_scans.source) that brought the visitor when known.
CREATE TABLE social_clicks (
  id         bigserial PRIMARY KEY,
  link       text        NOT NULL,
  source     text,
  user_agent text,
  referer    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX social_clicks_link_created_idx ON social_clicks (link, created_at);
