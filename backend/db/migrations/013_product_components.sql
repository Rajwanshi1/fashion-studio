-- "This order contains": generalizes the fixed dupatta/jacket add-ons into an
-- ordered per-product list. Additive — legacy dupatta_price/jacket_price on
-- products and order_items are deprecated (no longer read or written) and
-- dropped in a later migration.
CREATE TABLE product_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  optional boolean NOT NULL DEFAULT false,
  price integer CHECK (price >= 0),  -- paise; only meaningful when optional; NULL = no separate price
  position int NOT NULL DEFAULT 0
);
CREATE INDEX product_components_product_idx ON product_components (product_id, position);

INSERT INTO product_components (product_id, name, optional, price, position)
  SELECT id, 'Dupatta', true, dupatta_price, 0 FROM products WHERE dupatta_price IS NOT NULL;
INSERT INTO product_components (product_id, name, optional, price, position)
  SELECT id, 'Jacket', true, jacket_price, 1 FROM products WHERE jacket_price IS NOT NULL;

-- Order-line snapshot of the KEPT optional components: [{ "name", "price" }].
-- Lowercase names in the backfill keep historical invoice text byte-identical
-- ("— with dupatta & jacket").
ALTER TABLE order_items ADD COLUMN components jsonb NOT NULL DEFAULT '[]';
UPDATE order_items SET components =
  CASE WHEN dupatta_price IS NOT NULL
    THEN jsonb_build_array(jsonb_build_object('name', 'dupatta', 'price', dupatta_price))
    ELSE '[]'::jsonb END ||
  CASE WHEN jacket_price IS NOT NULL
    THEN jsonb_build_array(jsonb_build_object('name', 'jacket', 'price', jacket_price))
    ELSE '[]'::jsonb END
WHERE dupatta_price IS NOT NULL OR jacket_price IS NOT NULL;
