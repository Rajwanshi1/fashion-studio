-- Products v2: sale pricing, admin-only cost price, canonical colour family for
-- the shop filter, and a real multi-image gallery.
ALTER TABLE products DROP CONSTRAINT products_flag_check;
ALTER TABLE products
  ADD CONSTRAINT products_flag_check CHECK (flag IN ('bestseller','new','sale')),
  ADD COLUMN sale_price integer CHECK (sale_price > 0),   -- paise; meaningful only when flag='sale'
  ADD COLUMN color_family text CHECK (color_family IN
    ('red','pink','orange-rust','yellow-gold','green','blue','purple',
     'white-ivory','beige-nude','brown','black','multi')),
  ADD COLUMN cost_price integer CHECK (cost_price >= 0);  -- paise; admin-only

-- Ordered gallery. products.image_url stays as the denormalized primary photo
-- (= images[0].url) so cards, wishlist, cart and order snapshots keep working.
CREATE TABLE product_images (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  url text NOT NULL,
  position int NOT NULL DEFAULT 0,
  pose text NOT NULL DEFAULT ''
);
CREATE INDEX product_images_product_idx ON product_images (product_id, position);
