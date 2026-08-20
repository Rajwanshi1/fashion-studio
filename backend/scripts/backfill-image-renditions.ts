/**
 * Backfill renditions + dimensions for product photos uploaded before the
 * media CDN existed (migration 021): for every product_images row with
 * width IS NULL, download the master from S3, read its pixel size, generate
 * the downscaled JPEG renditions the storefront's srcset expects
 * (`<key>_w{320,640,1080,1600}.jpg`, only widths below the master's), stamp
 * everything Cache-Control: immutable, and write width/height onto the row.
 *
 *   npm run backfill:image-renditions -- --dry-run
 *   npm run backfill:image-renditions
 *   npm run backfill:image-renditions -- --product zardozi-court-lehenga-sage
 *
 * Idempotent: only rows with width IS NULL are touched, and re-uploading a
 * rendition just overwrites the same key. The master is self-copied
 * (MetadataDirective REPLACE) purely to add Cache-Control — bytes unchanged.
 * Needs DATABASE_URL, S3_UPLOADS_BUCKET and AWS credentials (AWS_REGION
 * defaults to ap-south-1) — on prod, run over SSM like backfill:photo-colors.
 */
import { CopyObjectCommand, GetObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import sharp from 'sharp';
import { createPool } from '../src/db';
import { PRODUCT_IMAGE_CACHE_CONTROL as CACHE_CONTROL, renditionKey } from '../src/lib/media';

const RENDITION_WIDTHS = [320, 640, 1080, 1600];
const RENDITION_JPEG_QUALITY = 85;

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const productFlag = argv.indexOf('--product');
const productSlug = productFlag === -1 ? null : (argv[productFlag + 1] ?? null);
// A bare `--product` (slug forgotten) must not degrade into "whole catalogue".
if (productFlag !== -1 && (!productSlug || productSlug.startsWith('--'))) {
  bail('--product needs a slug.');
}

function bail(msg: string): never {
  console.error(`${msg}\n\n  npm run backfill:image-renditions -- [--dry-run] [--product <slug>]`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) bail('DATABASE_URL is not set.');
const bucket = process.env.S3_UPLOADS_BUCKET?.trim();
if (!bucket) bail('S3_UPLOADS_BUCKET is not set.');
const region = process.env.AWS_REGION?.trim() || 'ap-south-1';
const mediaBaseUrl = process.env.MEDIA_BASE_URL?.trim().replace(/\/+$/, '') || null;

/**
 * Storage key from a stored URL — handles both populations: the legacy raw S3
 * form and (post-URL-backfill) the media-CDN form. Anything else is skipped.
 */
function keyFromUrl(url: string): string | null {
  const s3Prefix = `https://${bucket}.s3.${region}.amazonaws.com/`;
  if (url.startsWith(s3Prefix)) return url.slice(s3Prefix.length);
  if (mediaBaseUrl && url.startsWith(`${mediaBaseUrl}/`)) return url.slice(mediaBaseUrl.length + 1);
  return null;
}

// Wrapped in main() rather than using top-level await: the backend compiles to
// CommonJS, where esbuild rejects it.
async function main(): Promise<void> {
  const pool = createPool(databaseUrl!);
  const s3 = new S3Client({ region });

  const { rows } = await pool.query(
    `SELECT pi.id, pi.url, p.slug
       FROM product_images pi JOIN products p ON p.id = pi.product_id
      WHERE pi.width IS NULL ${productSlug ? 'AND p.slug = $1' : ''}
      ORDER BY p.slug, pi.position`,
    productSlug ? [productSlug] : [],
  );
  console.log(`${rows.length} photo(s) without dimensions${productSlug ? ` on ${productSlug}` : ''}`);

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const label = `${row.slug} ${String(row.url).split('/').pop()}`;
    const key = keyFromUrl(row.url);
    if (!key || !key.endsWith('.jpg')) {
      console.warn(`SKIP  ${label} — URL is not a bucket .jpg (${row.url})`);
      skipped += 1;
      continue;
    }

    let master: Buffer;
    let contentType: string;
    try {
      const res = await s3.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
      if (!res.Body) throw new Error('no body');
      master = Buffer.from(await res.Body.transformToByteArray());
      contentType = res.ContentType ?? 'image/jpeg';
    } catch (err) {
      console.warn(`SKIP  ${label} — GetObject failed: ${(err as Error).message}`);
      skipped += 1;
      continue;
    }

    let width: number | undefined;
    let height: number | undefined;
    try {
      ({ width, height } = await sharp(master).metadata());
    } catch (err) {
      console.warn(`SKIP  ${label} — unreadable image: ${(err as Error).message}`);
      skipped += 1;
      continue;
    }
    if (!width || !height) {
      console.warn(`SKIP  ${label} — no dimensions in metadata`);
      skipped += 1;
      continue;
    }

    const widths = RENDITION_WIDTHS.filter((w) => w < width!);
    if (dryRun) {
      console.log(`DRY   ${label} → ${width}x${height}, renditions [${widths.join(', ')}]`);
      updated += 1;
      continue;
    }

    for (const w of widths) {
      const resized = await sharp(master).resize({ width: w }).jpeg({ quality: RENDITION_JPEG_QUALITY }).toBuffer();
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: renditionKey(key, w),
          Body: resized,
          ContentType: 'image/jpeg',
          CacheControl: CACHE_CONTROL,
        }),
      );
    }
    // Self-copy the master to stamp Cache-Control — REPLACE swaps metadata
    // wholesale, so ContentType must be restated or it falls back to binary.
    await s3.send(
      new CopyObjectCommand({
        Bucket: bucket,
        CopySource: `${bucket}/${encodeURIComponent(key).replace(/%2F/g, '/')}`,
        Key: key,
        MetadataDirective: 'REPLACE',
        ContentType: contentType,
        CacheControl: CACHE_CONTROL,
      }),
    );
    await pool.query('UPDATE product_images SET width = $2, height = $3 WHERE id = $1', [
      row.id,
      width,
      height,
    ]);
    console.log(`OK    ${label} → ${width}x${height}, renditions [${widths.join(', ')}]`);
    updated += 1;
  }

  console.log(`\n${dryRun ? 'would update' : 'updated'} ${updated}, skipped ${skipped}`);
  await pool.end();
}

void main();
