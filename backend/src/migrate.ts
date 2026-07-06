import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { Pool } from 'pg';

/** Apply db/migrations/*.sql in filename order, tracking applied files. */
export async function migrate(pool: Pool, migrationsDir: string): Promise<string[]> {
  // Serialize concurrent boots (ASG replicas race to apply migrations).
  const lock = await pool.connect();
  await lock.query('SELECT pg_advisory_lock(727272)');
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    const files = readdirSync(migrationsDir).filter((f) => f.endsWith('.sql')).sort();
    const applied: string[] = [];
    for (const file of files) {
      const { rowCount } = await pool.query('SELECT 1 FROM schema_migrations WHERE name = $1', [file]);
      if (rowCount) continue;
      const sql = readFileSync(join(migrationsDir, file), 'utf8');
      const client = await pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(sql);
        await client.query('INSERT INTO schema_migrations (name) VALUES ($1)', [file]);
        await client.query('COMMIT');
        applied.push(file);
      } catch (err) {
        await client.query('ROLLBACK');
        throw err;
      } finally {
        client.release();
      }
    }
    return applied;
  } finally {
    await lock.query('SELECT pg_advisory_unlock(727272)');
    lock.release();
  }
}
