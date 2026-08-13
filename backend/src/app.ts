import { Hono } from 'hono';
import { bodyLimit } from 'hono/body-limit';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import { secureHeaders } from 'hono/secure-headers';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { ClicksRepo } from './data/clicks.repo';
import type { ContentRepo } from './data/content.repo';
import type { DocumentsRepo } from './data/documents.repo';
import type { EventsRepo } from './data/events.repo';
import type { MeasurementsRepo } from './data/measurements.repo';
import type { OtpsRepo } from './data/otps.repo';
import type { OrdersRepo } from './data/orders.repo';
import type { PaymentsRepo } from './data/payments.repo';
import type { ProductsRepo, WishlistRepo } from './data/products.repo';
import type { ReceiptsRepo } from './data/receipts.repo';
import type { ScansRepo } from './data/scans.repo';
import type { UsersRepo } from './data/users.repo';
import { rateLimit } from './middleware/rate-limit';
import { AuthEnv } from './middleware/auth';
import { adminRoutes } from './routes/admin.routes';
import { analyticsRoutes } from './routes/analytics.routes';
import { authRoutes } from './routes/auth.routes';
import { catalogRoutes } from './routes/catalog.routes';
import { contentRoutes } from './routes/content.routes';
import { orderRoutes } from './routes/orders.routes';
import { paymentRoutes } from './routes/payments.routes';
import { socialsRoutes } from './routes/socials.routes';
import { uploadsRoutes } from './routes/uploads.routes';
import type { CatalogAi } from './services/ai/catalog-ai';
import type { BillParser } from './services/ai/parser';
import { createAnalyticsService } from './services/analytics.service';
import { createAuthService, VerifyGoogleToken } from './services/auth.service';
import { createCatalogService } from './services/catalog.service';
import { createDocumentsService } from './services/documents.service';
import { createInvoicesService } from './services/invoices.service';
import type { LocalObjectStore, ObjectStore } from './services/objectstore';
import { createOrdersService } from './services/orders.service';
import { createPaymentsService, PaymentProvider } from './services/payments.service';
import type { SmsProvider } from './services/sms.provider';
import { createSocialsService } from './services/socials.service';
import type { WhatsAppProvider } from './services/whatsapp.provider';
import { DomainError, TxRunner } from './types';

export interface AppDeps {
  repos: {
    users: UsersRepo;
    products: ProductsRepo;
    wishlist: WishlistRepo;
    orders: OrdersRepo;
    payments: PaymentsRepo;
    scans: ScansRepo;
    clicks: ClicksRepo;
    events: EventsRepo;
    otps: OtpsRepo;
    receipts: ReceiptsRepo;
    documents: DocumentsRepo;
    measurements: MeasurementsRepo;
    content: ContentRepo;
  };
  /** Masked payments seam — null while payments are disabled (endpoints answer 503). */
  paymentProvider: PaymentProvider | null;
  /** Document photo storage — S3 in production, LocalObjectStore in dev/tests. */
  objectStore: ObjectStore;
  /** Masked parsing seam — null/undefined until ANTHROPIC_API_KEY exists (parse answers 503). */
  billParser?: BillParser | null;
  /** Masked catalog-AI seam — null/undefined until ANTHROPIC_API_KEY exists;
   *  colour mapping then falls back to keywords and image names to uuids. */
  catalogAi?: CatalogAi | null;
  /** Set only when the LocalObjectStore is active — mounts the dev-only /api/uploads transport. */
  localUploads?: LocalObjectStore | null;
  /** Masked Google sign-in seam — null/undefined until GOOGLE_CLIENT_ID exists. */
  verifyGoogleToken?: VerifyGoogleToken | null;
  /** Masked SMS seam — null/undefined while phone-OTP login is disabled (endpoints answer 503). */
  smsProvider?: SmsProvider | null;
  /** Masked WhatsApp seam — null/undefined while invoice sends are disabled (send answers 503). */
  whatsappProvider?: WhatsAppProvider | null;
  /** Fixed OTP for dev/e2e; only meaningful alongside the console provider. */
  otpDevCode?: string | null;
  jwtSecret: string;
  corsOrigins: string[];
  runInTransaction: TxRunner;
  /** Liveness probe against the DB pool; absent → /api/ready always 503. */
  pingDb?: () => Promise<void>;
  /** Product-image uploads; absent → the presign endpoint answers 503.
   *  `local` mounts the dev-only /api/uploads/local transport. */
  uploads?: { store: ObjectStore; local?: LocalObjectStore | null };
}

const DOMAIN_STATUS: Record<DomainError['code'], 400 | 401 | 404 | 409 | 429 | 502 | 503> = {
  EMAIL_TAKEN: 409,
  PHONE_TAKEN: 409,
  INVALID_PHONE: 400,
  TOO_MANY_REQUESTS: 429,
  SLUG_TAKEN: 409,
  INSUFFICIENT_STOCK: 409,
  PRICE_CHANGED: 409,
  OVER_COLLECTION: 409,
  ORDER_CANCELLED: 409,
  BILL_NUMBER_REQUIRED: 400,
  PAYMENT_ALREADY_FINAL: 409,
  INVALID_CREDENTIALS: 401,
  NOT_FOUND: 404,
  EMPTY_ORDER: 400,
  INVALID_STATUS_TRANSITION: 400,
  NOT_CONFIGURED: 503,
  INVALID_SOURCE: 400,
  INVALID_LINK: 400,
  DELIVERY_FAILED: 502,
};

export function createApp(deps: AppDeps) {
  const { repos, paymentProvider, verifyGoogleToken, jwtSecret, corsOrigins, runInTransaction } = deps;

  const auth = createAuthService({
    users: repos.users,
    jwtSecret,
    verifyGoogleToken,
    otps: repos.otps,
    smsProvider: deps.smsProvider,
    otpDevCode: deps.otpDevCode,
  });
  const catalog = createCatalogService({ products: repos.products });
  const orders = createOrdersService({
    products: repos.products,
    orders: repos.orders,
    users: repos.users,
    receipts: repos.receipts,
    documents: repos.documents,
    measurements: repos.measurements,
    runInTransaction,
  });
  const payments = createPaymentsService({ payments: repos.payments, orders: repos.orders, provider: paymentProvider });
  const socials = createSocialsService({ scans: repos.scans, clicks: repos.clicks });
  const analytics = createAnalyticsService({ events: repos.events });
  const documents = createDocumentsService({
    documents: repos.documents,
    store: deps.objectStore,
    parser: deps.billParser ?? null,
  });
  const invoices = createInvoicesService({ orders: repos.orders, whatsapp: deps.whatsappProvider ?? null });

  const app = new Hono<AuthEnv>();

  app.use(secureHeaders());
  // CORS must register before anything that can short-circuit a response
  // (body limits especially): a 413 without Access-Control-Allow-Origin
  // reaches the browser as an opaque "CORS error" instead of its real message.
  // maxAge lets the browser reuse the preflight instead of doubling every call.
  app.use('/api/*', cors({ origin: corsOrigins, allowHeaders: ['Content-Type', 'Authorization'], maxAge: 7200 }));
  // Global 100KB JSON cap — skipped for the dev-only local photo transport,
  // which enforces its own 10MB cap (uploads.routes.ts), and raised for the
  // product-image presign, whose body carries the base64 photo the naming call
  // looks at (capped at 14MB of base64 by its own schema).
  const jsonBodyLimit = bodyLimit({
    maxSize: 100 * 1024,
    onError: (c) => c.json({ error: 'Payload too large' }, 413),
  });
  const photoJsonBodyLimit = bodyLimit({
    maxSize: 15 * 1024 * 1024,
    onError: (c) => c.json({ error: 'Payload too large' }, 413),
  });
  app.use('/api/*', (c, next) => {
    if (c.req.path.startsWith('/api/uploads/local/')) return next();
    if (c.req.path === '/api/admin/uploads/product-image') return photoJsonBodyLimit(c, next);
    return jsonBodyLimit(c, next);
  });

  app.onError((err, c) => {
    if (err instanceof DomainError) return c.json({ error: err.message }, DOMAIN_STATUS[err.code]);
    // e.g. hono's 400 "Malformed JSON in request body" — keep its status but
    // normalize the body to the contract's { error: string } shape.
    if (err instanceof HTTPException) {
      return c.json({ error: err.message || 'Bad request' }, err.status as ContentfulStatusCode);
    }
    console.error(err);
    return c.json({ error: 'Internal server error' }, 500);
  });
  app.notFound((c) => c.json({ error: 'Not found' }, 404));

  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  app.get('/api/ready', async (c) => {
    if (!deps.pingDb) return c.json({ status: 'unavailable' }, 503);
    try {
      await Promise.race([
        deps.pingDb(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000)),
      ]);
      return c.json({ status: 'ready' });
    } catch {
      return c.json({ status: 'unavailable' }, 503);
    }
  });

  // OTP sends cost money and hit a third party — tighter window than the rest of auth.
  app.use('/api/auth/otp/*', rateLimit({ windowMs: 60_000, max: 10 }));
  app.use('/api/auth/*', rateLimit({ windowMs: 60_000, max: 30 }));
  app.use('/api/*', rateLimit({ windowMs: 60_000, max: 300 }));
  app.route('/api/auth', authRoutes(auth, jwtSecret));
  app.route('/api', catalogRoutes(catalog, repos.wishlist, jwtSecret));
  app.route('/api', orderRoutes(orders, jwtSecret));
  app.route('/api/payments', paymentRoutes(payments, jwtSecret));
  app.route('/api/socials', socialsRoutes(socials, jwtSecret));
  app.route('/api', contentRoutes(repos.content, jwtSecret));
  app.route('/api', analyticsRoutes(analytics, jwtSecret));
  // Dev-only local upload transport — never mounted when S3 is the store.
  if (deps.localUploads) app.route('/api/uploads', uploadsRoutes(deps.localUploads, jwtSecret));
  app.route(
    '/api/admin',
    adminRoutes({
      products: repos.products,
      orders: repos.orders,
      payments: repos.payments,
      users: repos.users,
      documents: repos.documents,
      measurements: repos.measurements,
      ordersService: orders,
      documentsService: documents,
      invoicesService: invoices,
      objectStore: deps.objectStore,
      catalogAi: deps.catalogAi ?? null,
      jwtSecret,
    }),
  );

  return app;
}
