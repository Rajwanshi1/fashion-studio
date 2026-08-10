-- Admin-editable storefront content: one row per fixed section (hero, ticker,
-- footer, ...). Absent row = storefront built-in default; reset = DELETE.
CREATE TABLE site_content (
  key        text        PRIMARY KEY,
  value      jsonb       NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
