-- WhatsApp invoice delivery: when the PDF invoice was last sent to the customer.
ALTER TABLE orders ADD COLUMN invoice_sent_at timestamptz;
