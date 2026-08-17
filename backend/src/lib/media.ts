/**
 * Legacy → CDN URL rewrite for product photos, applied AT READ TIME.
 *
 * Product image URLs are stored denormalized in three places (products.image_url,
 * product_images.url, order_items.image_url) as whatever the object store's
 * publicUrl() produced at upload time. Uploads made before the media CDN
 * existed carry the raw virtual-hosted S3 form. Rather than trusting a one-off
 * data migration to catch every copy, every read maps that legacy prefix onto
 * the CDN host — so the storefront stops referencing raw S3 the moment
 * MEDIA_BASE_URL is set, and the one-time SQL backfill (media-cdn runbook,
 * step 6) merely makes the stored data match what readers already serve.
 */

/**
 * Swap the legacy `https://<bucket>.s3.<region>.amazonaws.com/` prefix for
 * `mediaBaseUrl`. Identity when mediaBaseUrl/bucket is unset or the URL is
 * not in the legacy form (already-CDN URLs, dev-store URLs, foreign hosts).
 */
export function rewriteLegacyMediaUrl(
  url: string,
  mediaBaseUrl: string | null,
  bucket: string | null,
  region: string,
): string {
  if (!mediaBaseUrl || !bucket) return url;
  const legacyPrefix = `https://${bucket}.s3.${region}.amazonaws.com/`;
  if (!url.startsWith(legacyPrefix)) return url;
  return `${mediaBaseUrl}/${url.slice(legacyPrefix.length)}`;
}

/** Null-tolerant rewriter, shaped for the repos' image_url columns. */
export type UrlRewriter = (url: string | null) => string | null;

/** Builds the repos' rewriter once from config; identity when the CDN is off. */
export function makeUrlRewriter(
  mediaBaseUrl: string | null,
  bucket: string | null,
  region: string,
): UrlRewriter {
  if (!mediaBaseUrl || !bucket) return (url) => url;
  return (url) => (url == null ? url : rewriteLegacyMediaUrl(url, mediaBaseUrl, bucket, region));
}

/** Rewrites every legacy URL inside an arbitrary jsonb value (site_content
 *  sections bury imageUrls at several depths). The prefix is specific enough
 *  that a whole-document text swap is exact, and S3 URLs never contain the
 *  characters JSON would escape. Identity when the CDN is off. */
export type JsonRewriter = (value: unknown) => unknown;

export function makeJsonUrlRewriter(
  mediaBaseUrl: string | null,
  bucket: string | null,
  region: string,
): JsonRewriter {
  if (!mediaBaseUrl || !bucket) return (value) => value;
  const legacyPrefix = `https://${bucket}.s3.${region}.amazonaws.com/`;
  return (value) => {
    if (value == null) return value;
    const text = JSON.stringify(value);
    if (!text.includes(legacyPrefix)) return value;
    return JSON.parse(text.replaceAll(legacyPrefix, `${mediaBaseUrl}/`));
  };
}

/** Renditions sit beside their master as `<key>_w{width}.jpg` — this rule is
 *  load-bearing in three places (presign fan-out, backfill script, and the
 *  storefront's srcset builder, which mirrors it cross-package). */
export function renditionKey(masterKey: string, width: number): string {
  return masterKey.replace(/\.jpg$/, `_w${width}.jpg`);
}

/** Product photos and their renditions never change under a key — browsers
 *  and the CDN may cache them for a year. */
export const PRODUCT_IMAGE_CACHE_CONTROL = 'public,max-age=31536000,immutable';
