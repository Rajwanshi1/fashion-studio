-- Provenance (audit §06): who made the piece, how long it honestly took,
-- which techniques, and when it was finished. All optional — shown only when
-- filled, never invented.
ALTER TABLE products
  ADD COLUMN karigar_name text NOT NULL DEFAULT '',
  ADD COLUMN hours_worked integer CHECK (hours_worked > 0),
  ADD COLUMN techniques text NOT NULL DEFAULT '',
  ADD COLUMN finished_on date;
