-- Custom colour on request (+₹1,000): a per-product availability flag and a
-- per-line snapshot of whether the shopper asked for it. ON for every existing
-- garment (business decision — the atelier can re-dye any current piece).
ALTER TABLE products ADD COLUMN custom_color_available boolean NOT NULL DEFAULT true;
ALTER TABLE order_items ADD COLUMN custom_color boolean NOT NULL DEFAULT false;
