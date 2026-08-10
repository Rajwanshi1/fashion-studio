import { Pool } from 'pg';

export interface ContentRow {
  key: string;
  value: unknown;
}

export interface ContentRepo {
  all(): Promise<ContentRow[]>;
  upsert(key: string, value: unknown): Promise<void>;
  remove(key: string): Promise<void>;
}

export function createContentRepo(pool: Pool): ContentRepo {
  return {
    async all() {
      const { rows } = await pool.query('SELECT key, value FROM site_content');
      return rows.map((row) => ({ key: row.key, value: row.value }));
    },

    async upsert(key, value) {
      await pool.query(
        `INSERT INTO site_content (key, value) VALUES ($1, $2::jsonb)
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now()`,
        [key, JSON.stringify(value)],
      );
    },

    async remove(key) {
      await pool.query('DELETE FROM site_content WHERE key = $1', [key]);
    },
  };
}
