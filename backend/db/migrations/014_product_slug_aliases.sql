-- Slug renames without link rot: when a piece's slug changes, the outgoing
-- slug is recorded here and keeps resolving to the piece. Aliases point at the
-- product id (never at another slug), so renames can't chain or cycle.
CREATE TABLE product_slug_aliases (
  old_slug text PRIMARY KEY,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
