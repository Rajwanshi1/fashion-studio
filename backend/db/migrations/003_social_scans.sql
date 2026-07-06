-- Link-in-bio "socials" page — QR/link scan-source tracking
CREATE TABLE social_scans (
  id         bigserial PRIMARY KEY,
  source     text        NOT NULL,
  user_agent text,
  referer    text,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX social_scans_source_created_idx ON social_scans (source, created_at);
