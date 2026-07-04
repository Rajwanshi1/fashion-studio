-- Tanvi Agnihotry boutique — initial schema
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE users (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  email text NOT NULL UNIQUE,
  password_hash text NOT NULL,
  first_name text NOT NULL DEFAULT '',
  last_name text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'customer' CHECK (role IN ('customer','admin')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  position int NOT NULL DEFAULT 0
);

CREATE TABLE products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  category_id uuid NOT NULL REFERENCES categories(id),
  slug text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  details text NOT NULL DEFAULT '',
  price integer NOT NULL CHECK (price >= 0),          -- paise
  color text NOT NULL DEFAULT '',
  flag text CHECK (flag IN ('bestseller','new')),
  image_url text,
  active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE product_variants (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  size text NOT NULL,
  stock integer NOT NULL DEFAULT 0 CHECK (stock >= 0),
  UNIQUE (product_id, size)
);

CREATE SEQUENCE order_number_seq START 4818;

CREATE TABLE orders (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_number text NOT NULL UNIQUE,
  user_id uuid REFERENCES users(id),
  email text NOT NULL,
  phone text NOT NULL DEFAULT '',
  first_name text NOT NULL,
  last_name text NOT NULL DEFAULT '',
  address_line1 text NOT NULL,
  address_line2 text NOT NULL DEFAULT '',
  city text NOT NULL,
  state text NOT NULL,
  pincode text NOT NULL,
  country text NOT NULL DEFAULT 'India',
  delivery_method text NOT NULL DEFAULT 'standard' CHECK (delivery_method IN ('standard','priority')),
  delivery_fee integer NOT NULL DEFAULT 0,             -- paise
  subtotal integer NOT NULL,                           -- paise
  total integer NOT NULL,                              -- paise
  status text NOT NULL DEFAULT 'pending_payment'
    CHECK (status IN ('pending_payment','paid','in_atelier','quality_check','dispatched','delivered','cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE order_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id),
  variant_id uuid NOT NULL REFERENCES product_variants(id),
  product_name text NOT NULL,
  size text NOT NULL,
  color text NOT NULL DEFAULT '',
  unit_price integer NOT NULL,                         -- paise
  quantity integer NOT NULL CHECK (quantity > 0),
  image_url text
);

CREATE TABLE payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id),
  provider text NOT NULL DEFAULT 'razorpay_mock',
  provider_order_id text NOT NULL,
  provider_payment_id text,
  amount integer NOT NULL,                             -- paise
  currency text NOT NULL DEFAULT 'INR',
  status text NOT NULL DEFAULT 'created' CHECK (status IN ('created','captured','failed','refunded')),
  method text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE wishlists (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, product_id)
);

CREATE INDEX idx_products_category ON products(category_id);
CREATE INDEX idx_variants_product ON product_variants(product_id);
CREATE INDEX idx_orders_user ON orders(user_id);
CREATE INDEX idx_orders_status ON orders(status);
CREATE INDEX idx_order_items_order ON order_items(order_id);
CREATE INDEX idx_payments_order ON payments(order_id);
