-- Catalog v2: set-includes pricing, merchandising fields, soft-archive.
ALTER TABLE products
  ADD COLUMN deleted_at timestamptz,
  ADD COLUMN collection text NOT NULL DEFAULT '',
  ADD COLUMN craft      text NOT NULL DEFAULT '',
  ADD COLUMN fabric     text NOT NULL DEFAULT '',
  ADD COLUMN occasion   text NOT NULL DEFAULT '',
  ADD COLUMN dupatta_price integer CHECK (dupatta_price >= 0),  -- paise; NULL = not part of the set
  ADD COLUMN jacket_price  integer CHECK (jacket_price  >= 0);  -- paise; NULL = not part of the set

-- Snapshot of the CHOSEN addon prices at order time (NULL = excluded or absent).
-- unit_price stores the final per-unit price (base + chosen addons).
ALTER TABLE order_items
  ADD COLUMN dupatta_price integer CHECK (dupatta_price >= 0),
  ADD COLUMN jacket_price  integer CHECK (jacket_price  >= 0);
