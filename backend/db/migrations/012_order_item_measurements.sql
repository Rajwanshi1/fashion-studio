-- Made to measure: optional free-text measurement note, snapshotted per line.
-- Display-only ('' = none); the default keeps the offline/admin INSERT path untouched.
ALTER TABLE order_items
  ADD COLUMN measurements text NOT NULL DEFAULT '';
