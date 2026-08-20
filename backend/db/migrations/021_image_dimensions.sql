-- Master-photo pixel dimensions, written by the admin uploader only once
-- EVERY rendition PUT succeeded (media CDN, PR-A). NULL = a pre-renditions
-- upload: the storefront gates srcset on these columns, so a NULL row never
-- advertises _w320/_w640/... candidates that were never generated. The
-- backfill script (scripts/backfill-image-renditions.ts) generates renditions
-- for NULL rows and fills the columns in.
ALTER TABLE product_images
  ADD COLUMN width integer CHECK (width > 0),
  ADD COLUMN height integer CHECK (height > 0);
