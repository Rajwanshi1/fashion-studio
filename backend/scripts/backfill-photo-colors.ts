/**
 * Backfill product_images.color / color_hex for photos uploaded before the
 * colour columns existed (migration 014), by re-running the same vision call
 * that names uploads today.
 *
 *   npm run backfill:photo-colors -- --dry-run
 *   npm run backfill:photo-colors
 *   npm run backfill:photo-colors -- --product zardozi-court-lehenga-sage
 *
 * Idempotent: only rows with color = '' are touched, and a row the model can't
 * read stays '' (re-runnable; correct it by hand in the admin gallery instead).
 * Costs real money (a few rupees for a boutique-sized catalogue). Needs
 * DATABASE_URL and ANTHROPIC_API_KEY — on prod, run over SSM like parse:photo.
 */
import { createPool } from '../src/db';
import { createAnthropicClient } from '../src/services/ai/anthropic';
import { AnthropicCatalogAi } from '../src/services/ai/catalog-ai-anthropic';

const argv = process.argv.slice(2);
const dryRun = argv.includes('--dry-run');
const productFlag = argv.indexOf('--product');
const productSlug = productFlag === -1 ? null : (argv[productFlag + 1] ?? null);

function bail(msg: string): never {
  console.error(`${msg}\n\n  npm run backfill:photo-colors -- [--dry-run] [--product <slug>]`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) bail('DATABASE_URL is not set.');
const apiKey = process.env.ANTHROPIC_API_KEY?.trim();
if (!apiKey) bail('ANTHROPIC_API_KEY is not set — put it in backend/.env (gitignored) or export it.');

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

// Wrapped in main() rather than using top-level await: the backend compiles to
// CommonJS, where esbuild rejects it.
async function main(): Promise<void> {
  const pool = createPool(databaseUrl!);
  const catalogAi = new AnthropicCatalogAi(createAnthropicClient(apiKey!));

  const { rows } = await pool.query(
    `SELECT pi.id, pi.url, p.name AS product_name, p.slug
       FROM product_images pi JOIN products p ON p.id = pi.product_id
      WHERE pi.color = '' ${productSlug ? 'AND p.slug = $1' : ''}
      ORDER BY p.slug, pi.position`,
    productSlug ? [productSlug] : [],
  );
  console.log(`${rows.length} photo(s) without a colour${productSlug ? ` on ${productSlug}` : ''}`);

  let updated = 0;
  let skipped = 0;
  for (const row of rows) {
    const label = `${row.slug} ${String(row.url).split('/').pop()}`;
    let bytes: Uint8Array;
    let mediaType: string;
    try {
      const res = await fetch(row.url);
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      bytes = new Uint8Array(await res.arrayBuffer());
      mediaType = res.headers.get('content-type')?.split(';')[0] || 'image/jpeg';
    } catch (err) {
      console.warn(`SKIP  ${label} — fetch failed: ${(err as Error).message}`);
      skipped += 1;
      continue;
    }

    const named = await catalogAi.nameProductImage({ bytes, mediaType }, row.product_name);
    if (!named?.colorName) {
      console.warn(`SKIP  ${label} — model returned no colour`);
      skipped += 1;
      continue;
    }

    if (dryRun) {
      console.log(`DRY   ${label} → ${named.colorName} ${named.colorHex ?? '(no hex)'}`);
    } else {
      await pool.query('UPDATE product_images SET color = $2, color_hex = $3 WHERE id = $1', [
        row.id,
        named.colorName,
        named.colorHex ?? '',
      ]);
      console.log(`OK    ${label} → ${named.colorName} ${named.colorHex ?? '(no hex)'}`);
    }
    updated += 1;
    await sleep(500); // gentle on the API — sequential by design
  }

  console.log(`\n${dryRun ? 'would update' : 'updated'} ${updated}, skipped ${skipped}`);
  await pool.end();
}

void main();
