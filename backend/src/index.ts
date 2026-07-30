import { serve } from '@hono/node-server';
import path from 'path';
import { createApp } from './app';
import { loadConfig } from './config';
import { createClicksRepo } from './data/clicks.repo';
import { createDocumentsRepo } from './data/documents.repo';
import { createEventsRepo } from './data/events.repo';
import { createMeasurementsRepo } from './data/measurements.repo';
import { createOtpsRepo } from './data/otps.repo';
import { createOrdersRepo } from './data/orders.repo';
import { createPaymentsRepo } from './data/payments.repo';
import { createProductsRepo, createWishlistRepo } from './data/products.repo';
import { createReceiptsRepo } from './data/receipts.repo';
import { createScansRepo } from './data/scans.repo';
import { createUsersRepo } from './data/users.repo';
import { createPool, makeTxRunner } from './db';
import { migrate } from './migrate';
import { seed } from './seed';
import { createBedrockClient } from './services/ai/bedrock';
import { AnthropicBillParser } from './services/ai/parser';
import { PARSE_SPECS } from './services/ai/prompts';
import { createGoogleVerifier } from './services/google.verifier';
import { LocalObjectStore, S3ObjectStore } from './services/objectstore';
import { MockRazorpayProvider } from './services/payments.service';
import { ConsoleSmsProvider, Msg91SmsProvider } from './services/sms.provider';

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

  // S3 in any deployed environment; the LocalObjectStore (plus its dev-only
  // /api/uploads transport) only when no bucket is configured.
  const localUploads = config.s3UploadsBucket ? null : new LocalObjectStore(config.uploadsDir, config.publicApiUrl);
  const objectStore = config.s3UploadsBucket ? new S3ObjectStore(config.s3UploadsBucket) : localUploads!;
  // Always constructed: with IAM auth there is no key to be missing, so
  // "configured" means "IAM and Bedrock model access allow it". If they don't,
  // the parse call fails as NOT_CONFIGURED (503) and the wizard falls back to
  // manual entry — the same degradation a missing key used to produce.
  const billParser = new AnthropicBillParser(createBedrockClient(config.bedrockRegion));

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
      otps: createOtpsRepo(pool),
      receipts: createReceiptsRepo(pool),
      documents: createDocumentsRepo(pool),
      measurements: createMeasurementsRepo(pool),
    },
    paymentProvider: config.paymentProvider === 'mock' ? new MockRazorpayProvider() : null,
    objectStore,
    billParser,
    localUploads,
    verifyGoogleToken: config.googleClientId ? createGoogleVerifier(config.googleClientId) : null,
    smsProvider:
      config.smsProvider === 'msg91'
        ? new Msg91SmsProvider(config.msg91AuthKey!, config.msg91TemplateId!)
        : config.smsProvider === 'console'
          ? new ConsoleSmsProvider()
          : null,
    otpDevCode: config.otpDevCode,
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
  if (config.smsProvider === 'msg91') console.log('auth: phone OTP via MSG91');
  else if (config.smsProvider === 'console') console.warn('auth: phone OTP codes printed to console — dev only');
  else console.log('auth: phone OTP masked — set SMS_PROVIDER to enable');
  if (config.s3UploadsBucket) console.log(`documents: S3 bucket ${config.s3UploadsBucket}`);
  else console.warn(`documents: local dev store at ${config.uploadsDir} — set S3_UPLOADS_BUCKET in production`);
  const models = Object.entries(PARSE_SPECS)
    .map(([kind, spec]) => `${kind}=${spec.model}/${spec.effort}`)
    .join(' ');
  console.log(`ai: bill parsing via Bedrock in ${config.bedrockRegion} — ${models}`);

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
