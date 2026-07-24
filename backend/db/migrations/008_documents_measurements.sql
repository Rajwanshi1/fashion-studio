CREATE TABLE documents (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  storage_key text NOT NULL UNIQUE,
  kind text NOT NULL CHECK (kind IN ('bill','measurement','shipping_receipt')),
  content_type text NOT NULL DEFAULT 'image/jpeg',
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  uploaded_by uuid REFERENCES users(id),
  parse jsonb,
  status text NOT NULL DEFAULT 'uploaded'
    CHECK (status IN ('uploaded','parsed','confirmed','discarded')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_documents_order ON documents(order_id);

CREATE TABLE measurements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES users(id),
  order_id uuid REFERENCES orders(id) ON DELETE SET NULL,
  document_id uuid REFERENCES documents(id),
  label text NOT NULL DEFAULT '',
  data jsonb NOT NULL DEFAULT '{}'::jsonb,
  notes text NOT NULL DEFAULT '',
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_measurements_user ON measurements(user_id);

ALTER TABLE orders ADD COLUMN carrier text, ADD COLUMN awb text;
