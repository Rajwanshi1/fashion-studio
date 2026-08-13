-- Made-to-order stock model: stock is an internal signal, never a sales gate.
-- Orders may drive stock negative (negative = MTO backlog / oversold), so the
-- CHECK (stock >= 0) from 001_schema.sql must go. The constraint was created
-- inline, so its name is Postgres-generated — look it up instead of hardcoding.
DO $$
DECLARE
  con text;
BEGIN
  SELECT conname INTO con
  FROM pg_constraint
  WHERE conrelid = 'product_variants'::regclass
    AND contype = 'c'
    AND pg_get_constraintdef(oid) LIKE '%stock%';
  IF con IS NOT NULL THEN
    EXECUTE format('ALTER TABLE product_variants DROP CONSTRAINT %I', con);
  END IF;
END $$;
