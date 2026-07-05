import { Pool, PoolClient } from 'pg';
import { TxRunner } from './types';

export function createPool(databaseUrl: string): Pool {
  return new Pool({ connectionString: databaseUrl, max: 10 });
}

/** Run fn inside a transaction; commits on success, rolls back on throw. */
export async function withTransaction<T>(
  pool: Pool,
  fn: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('COMMIT');
    return result;
  } catch (err) {
    await client.query('ROLLBACK');
    throw err;
  } finally {
    client.release();
  }
}

/** Injectable transaction runner for services (keeps pg out of the app layer). */
export function makeTxRunner(pool: Pool): TxRunner {
  return (fn) => withTransaction(pool, (client) => fn(client));
}
