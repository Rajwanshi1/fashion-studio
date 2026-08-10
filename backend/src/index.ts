import { serve } from '@hono/node-server';
import path from 'path';
import { createApp } from './app';
import { loadConfig } from './config';
import { createClicksRepo } from './data/clicks.repo';
import { createContentRepo } from './data/content.repo';
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
import { createAnthropicClient } from './services/ai/anthropic';
import { AnthropicCatalogAi, CATALOG_AI_EFFORT, CATALOG_AI_MODEL } from './services/ai/catalog-ai-anthropic';
import { AnthropicBillParser } from './services/ai/parser';
import { PARSE_SPECS } from './services/ai/prompts';
import { createGoogleVerifier } from './services/google.verifier';
import { LocalObjectStore, S3ObjectStore } from './services/objectstore';
import { MockRazorpayProvider } from './services/payments.service';
import { ConsoleSmsProvider, Msg91SmsProvider } from './services/sms.provider';
import { ConsoleWhatsAppProvider, MetaWhatsAppProvider } from './services/whatsapp.provider';

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
  const localUploads = config.s3UploadsBucket
    ? null
    : new LocalObjectStore(config.uploadsDir, config.publicApiUrl);
  // Region is passed explicitly because publicUrl builds a virtual-hosted URL
  // for the public-read products/ prefix.
  const objectStore = config.s3UploadsBucket
    ? new S3ObjectStore(config.s3UploadsBucket, { region: config.awsRegion })
    : localUploads!;
  // Null until the key exists, which keeps the parse endpoint answering 503 and
  // the intake wizard falling back to manual entry. Models come from PARSE_SPECS
  // per document kind, so no model is passed here.
  const billParser = config.anthropicApiKey
    ? new AnthropicBillParser(createAnthropicClient(config.anthropicApiKey))
    : null;
  // Same key, separate client: catalog assist is best-effort on the product
  // save and upload paths. Null keeps colour on the keyword map and image names
  // on uuid keys, which is exactly the no-API-key behaviour.
  const catalogAi = config.anthropicApiKey
    ? new AnthropicCatalogAi(createAnthropicClient(config.anthropicApiKey))
    : null;

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
      content: createContentRepo(pool),
    },
    paymentProvider: config.paymentProvider === 'mock' ? new MockRazorpayProvider() : null,
    objectStore,
    billParser,
    catalogAi,
    localUploads,
    verifyGoogleToken: config.googleClientId ? createGoogleVerifier(config.googleClientId) : null,
    smsProvider:
      config.smsProvider === 'msg91'
        ? new Msg91SmsProvider(config.msg91AuthKey!, config.msg91TemplateId!)
        : config.smsProvider === 'console'
          ? new ConsoleSmsProvider()
          : null,
    otpDevCode: config.otpDevCode,
    whatsappProvider:
      config.whatsappProvider === 'meta'
        ? new MetaWhatsAppProvider(config.whatsappAccessToken!, config.whatsappPhoneNumberId!)
        : config.whatsappProvider === 'console'
          ? new ConsoleWhatsAppProvider()
          : null,
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
  if (config.whatsappProvider === 'meta') console.log('whatsapp: invoice sends via the Meta Cloud API');
  else if (config.whatsappProvider === 'console') console.warn('whatsapp: invoice sends printed to console — dev only');
  else console.log('whatsapp: invoice sends masked — set WHATSAPP_PROVIDER to enable');
  if (config.s3UploadsBucket) {
    console.log(`uploads: S3 bucket ${config.s3UploadsBucket} — product images (public products/) + documents (private)`);
  } else {
    console.warn(`uploads: local dev store at ${config.uploadsDir} — set S3_UPLOADS_BUCKET in production`);
  }
  if (config.anthropicApiKey) {
    const models = Object.entries(PARSE_SPECS)
      .map(([kind, spec]) => `${kind}=${spec.model}/${spec.effort}`)
      .join(' ');
    console.log(`ai: bill parsing via the Claude API — ${models}`);
  } else {
    console.log('ai: parsing masked — set ANTHROPIC_API_KEY to enable');
  }
  if (config.anthropicApiKey) {
    console.log(
      `ai: catalog assist via the Claude API — colour mapping + image naming on ${CATALOG_AI_MODEL}/${CATALOG_AI_EFFORT}`,
    );
  } else {
    console.log('ai: catalog assist masked — colours use the keyword map only, image names stay uuid keys');
  }
  // Stated rather than silent, so nobody sets it and wonders why nothing changed.
  // Not a warning: the deployed launch template still exports it, so this is the
  // expected state until that parameter is dropped (see config.ts, main.yaml).
  if (process.env.ANTHROPIC_MODEL?.trim()) {
    console.log(
      `ai: ANTHROPIC_MODEL=${process.env.ANTHROPIC_MODEL.trim()} is ignored — models are per document kind in src/services/ai/prompts.ts`,
    );
  }

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
