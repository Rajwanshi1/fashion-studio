-- Order channels: offline orders (in-store / Instagram / exhibition) with
-- handwritten-bill metadata, freeform line items and payment receipts.
ALTER TABLE orders
  ADD COLUMN channel text NOT NULL DEFAULT 'online'
    CHECK (channel IN ('online','in_store','instagram','exhibition')),
  ADD COLUMN bill_type text CHECK (bill_type IN ('gst_invoice','cash_memo')),
  ADD COLUMN bill_number text,
  ADD COLUMN gst_amount integer,                      -- paise, nullable
  ADD COLUMN delivery_due_date date,
  ADD COLUMN notes text NOT NULL DEFAULT '';
ALTER TABLE orders ALTER COLUMN email SET DEFAULT '';
ALTER TABLE order_items ALTER COLUMN product_id DROP NOT NULL;
ALTER TABLE order_items ALTER COLUMN variant_id DROP NOT NULL;
ALTER TABLE order_items ALTER COLUMN size SET DEFAULT '';

CREATE TABLE order_receipts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  order_id uuid NOT NULL REFERENCES orders(id) ON DELETE CASCADE,
  amount integer NOT NULL CHECK (amount > 0),          -- paise
  mode text NOT NULL CHECK (mode IN ('cash','online')),
  received_at date NOT NULL DEFAULT CURRENT_DATE,
  note text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_order_receipts_order ON order_receipts(order_id);
CREATE INDEX idx_orders_channel ON orders(channel);
CREATE INDEX idx_orders_due ON orders(delivery_due_date) WHERE delivery_due_date IS NOT NULL;
