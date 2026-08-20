-- First-order 5% discount: paise actually taken off the total, plus a machine
-- reason ('first_order_5pct') so future offers stay distinguishable. Defaults
-- keep every existing row and the offline-order INSERT untouched.
ALTER TABLE orders
  ADD COLUMN discount_amount integer NOT NULL DEFAULT 0 CHECK (discount_amount >= 0),
  ADD COLUMN discount_reason text NOT NULL DEFAULT '';
