import { serve } from '@hono/node-server';
import path from 'path';
import { createApp } from './app';
import { loadConfig } from './config';
import { createClicksRepo } from './data/clicks.repo';
import { createEventsRepo } from './data/events.repo';
import { createOrdersRepo } from './data/orders.repo';
import { createPaymentsRepo } from './data/payments.repo';
import { createProductsRepo, createWishlistRepo } from './data/products.repo';
import { createScansRepo } from './data/scans.repo';
import { createUsersRepo } from './data/users.repo';
import { createPool, makeTxRunner } from './db';
import { migrate } from './migrate';
import { seed } from './seed';
import { createGoogleVerifier } from './services/google.verifier';
import { MockRazorpayProvider } from './services/payments.service';

async function main() {
  const config = loadConfig();
  const pool = createPool(config.databaseUrl);

  // Works in dev (tsx from backend/) and in the image (db/ next to dist/).
  const migrationsDir = process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), 'db', 'migrations');
  const applied = await migrate(pool, migrationsDir);
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);

  if (config.seedOnStart) {
    const seeded = await seed(pool, {
      adminPassword: process.env.SEED_ADMIN_PASSWORD,
      customerPassword: process.env.SEED_CUSTOMER_PASSWORD,
    });
    console.log(seeded ? 'Seeded catalog + users' : 'Seed skipped (products already exist)');
  }

  const app = createApp({
    repos: {
      users: createUsersRepo(pool),
      products: createProductsRepo(pool),
      wishlist: createWishlistRepo(pool),
      orders: createOrdersRepo(pool),
      payments: createPaymentsRepo(pool),
      scans: createScansRepo(pool),
      clicks: createClicksRepo(pool),
      events: createEventsRepo(pool),
    },
    paymentProvider: config.paymentProvider === 'mock' ? new MockRazorpayProvider() : null,
    verifyGoogleToken: config.googleClientId ? createGoogleVerifier(config.googleClientId) : null,
    jwtSecret: config.jwtSecret,
    corsOrigins: config.corsOrigins,
    runInTransaction: makeTxRunner(pool),
    pingDb: async () => {
      await pool.query('SELECT 1');
    },
  });

  if (config.paymentProvider === 'mock') {
    console.warn('payments: MOCK Razorpay provider active — do not use in production');
  } else {
    console.log('payments: disabled — checkout/confirm answer 503 until a real provider is configured');
  }
  if (config.googleClientId) console.log('auth: Google sign-in enabled');
  else console.warn('auth: Google sign-in masked — set GOOGLE_CLIENT_ID to enable');

  const server = serve({ fetch: app.fetch, port: config.port }, (info) => {
    console.log(`Tanvi Agnihotry API listening on :${info.port}`);
  });

  const shutdown = (signal: string) => {
    console.log(`${signal} received — shutting down gracefully`);
    server.close(() => {
      pool.end().then(() => process.exit(0));
    });
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

main().catch((err) => {
  console.error('Fatal startup error:', err);
  process.exit(1);
});
