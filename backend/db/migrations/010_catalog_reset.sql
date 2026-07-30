-- ONE-TIME HARD RESET (explicitly requested): wipe all catalog + order data
-- and install the new five-category taxonomy. Every environment restarts with
-- an empty catalog; products are re-created through the admin app (or the seed
-- in dev). User accounts are untouched. CASCADE also clears any future tables
-- that FK orders/products on environments where they already exist.
TRUNCATE TABLE order_items, payments, orders, wishlists,
               product_variants, products, categories CASCADE;

ALTER SEQUENCE order_number_seq RESTART WITH 4818;

INSERT INTO categories (slug, name, description, position) VALUES
  ('kaftan',   'Kaftan',   'Fluid kaftans in tissue and organza — unhurried ease, cut for occasion.', 1),
  ('anarkali', 'Anarkali', 'Floor-grazing anarkalis with fine threadwork and heritage silhouettes.', 2),
  ('suits',    'Suits',    'Tailored suit sets — structured, hand-finished, made to order.', 3),
  ('lehenga',  'Lehenga',  'Hand-embroidered lehengas — zardozi, mirror and sequin craft.', 4),
  ('antifit',  'Antifit',  'Anti-fit silhouettes — architectural drape, unforced ease.', 5);
