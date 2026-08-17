import { Pool } from 'pg';
import type { JsonRewriter } from '../lib/media';

export interface ContentRow {
  key: string;
  value: unknown;
}

export interface ContentRepo {
  all(): Promise<ContentRow[]>;
  upsert(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

/** `rewriteUrls` is the same legacy-S3→CDN safety net the product repos get:
 *  applied at read (stale stored URLs) AND at write (an admin tab opened
 *  before the URL backfill can round-trip a raw S3 URL back in — CMS images
 *  have no other repair path once the bucket's public read closes). */
export function createContentRepo(pool: Pool, rewriteUrls: JsonRewriter = (v) => v): ContentRepo {
  return {
    async all() {
      const { rows } = await pool.query('SELECT key, value FROM site_content');
      return rows.map((row) => ({ key: row.key, value: rewriteUrls(row.value) }));
    },

    async upsert(key, value) {
      await pool.query(
        `INSERT INTO site_content (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(rewriteUrls(value))],
      );
    },

    async remove(key) {
      await pool.query('DELETE FROM site_content WHERE key = $1', [key]);
    },
  };
}
