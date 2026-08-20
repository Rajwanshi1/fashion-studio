/**
 * Prune analytics events past the 180-day retention window, in batches so the
 * delete never holds a long lock on the hot events table.
 *
 *   npm run prune:events -- --dry-run
 *   npm run prune:events
 *
 * Idempotent and safe to re-run (or cron). Needs DATABASE_URL — on prod, run
 * over SSM like parse:photo.
 */
import { createPool } from '../src/db';

const RETENTION_DAYS = 180;
const BATCH = 10_000;

const dryRun = process.argv.slice(2).includes('--dry-run');

function bail(msg: string): never {
  console.error(`${msg}\n\n  npm run prune:events -- [--dry-run]`);
  process.exit(1);
}

const databaseUrl = process.env.DATABASE_URL?.trim();
if (!databaseUrl) bail('DATABASE_URL is not set.');

// Wrapped in main() rather than using top-level await: the backend compiles to
// CommonJS, where esbuild rejects it.
async function main(): Promise<void> {
  const pool = createPool(databaseUrl!);

  const { rows } = await pool.query(
    `SELECT COUNT(*)::int AS stale FROM events
     WHERE created_at < now() - make_interval(days => $1)`,
    [RETENTION_DAYS],
  );
  const stale: number = rows[0].stale;
  console.log(`${stale} event(s) older than ${RETENTION_DAYS} days`);

  if (dryRun || stale === 0) {
    console.log(dryRun ? 'dry run — nothing deleted' : 'nothing to prune');
    await pool.end();
    return;
  }

  let deleted = 0;
  for (;;) {
    const res = await pool.query(
      `DELETE FROM events WHERE id IN (
         SELECT id FROM events
         WHERE created_at < now() - make_interval(days => $1)
         LIMIT $2
       )`,
      [RETENTION_DAYS, BATCH],
    );
    if (!res.rowCount) break;
    deleted += res.rowCount;
    console.log(`deleted ${deleted}…`);
  }

  console.log(`\ndeleted ${deleted} event(s)`);
  await pool.end();
}

void main();
