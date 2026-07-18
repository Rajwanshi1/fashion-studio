import path from 'path';
import { createPool } from './db';
import { migrate } from './migrate';
import { seed } from './seed';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = createPool(url);
  const dir = process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), 'db', 'migrations');
  const applied = await migrate(pool, dir);
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
  const seeded = await seed(pool, {
    adminPassword: process.env.SEED_ADMIN_PASSWORD,
    customerPassword: process.env.SEED_CUSTOMER_PASSWORD,
    demoCustomer: process.env.SEED_DEMO_CUSTOMER !== 'false',
  });
  console.log(seeded ? 'Seeded catalog + users' : 'Seed skipped (products already exist)');
  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
