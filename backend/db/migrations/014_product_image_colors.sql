-- Per-photo colour, auto-read by the same vision call that names the photo.
-- '' = unknown (same convention as pose). color is the display name the PDP
-- swatch row shows ("Maroon"); color_hex is the CSS fill ('#rrggbb').
ALTER TABLE product_images
  ADD COLUMN color text NOT NULL DEFAULT '',
  ADD COLUMN color_hex text NOT NULL DEFAULT '';
