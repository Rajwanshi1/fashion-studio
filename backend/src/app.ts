import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { HTTPException } from 'hono/http-exception';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { OrdersRepo } from './data/orders.repo';
import type { PaymentsRepo } from './data/payments.repo';
import type { ProductsRepo, WishlistRepo } from './data/products.repo';
import type { ScansRepo } from './data/scans.repo';
import type { UsersRepo } from './data/users.repo';
import { AuthEnv } from './middleware/auth';
import { adminRoutes } from './routes/admin.routes';
import { authRoutes } from './routes/auth.routes';
import { catalogRoutes } from './routes/catalog.routes';
import { orderRoutes } from './routes/orders.routes';
import { paymentRoutes } from './routes/payments.routes';
import { socialsRoutes } from './routes/socials.routes';
import { createAuthService, VerifyGoogleToken } from './services/auth.service';
import { createCatalogService } from './services/catalog.service';
import { createOrdersService } from './services/orders.service';
import { createPaymentsService, PaymentProvider } from './services/payments.service';
import { createSocialsService } from './services/socials.service';
import { DomainError, TxRunner } from './types';

export interface AppDeps {
  repos: {
    users: UsersRepo;
    products: ProductsRepo;
    wishlist: WishlistRepo;
    orders: OrdersRepo;
    payments: PaymentsRepo;
    scans: ScansRepo;
  };
  paymentProvider: PaymentProvider;
  /** Masked Google sign-in seam — null/undefined until GOOGLE_CLIENT_ID exists. */
  verifyGoogleToken?: VerifyGoogleToken | null;
  jwtSecret: string;
  corsOrigins: string[];
  runInTransaction: TxRunner;
}

const DOMAIN_STATUS: Record<DomainError['code'], 400 | 401 | 404 | 409 | 503> = {
  EMAIL_TAKEN: 409,
  INSUFFICIENT_STOCK: 409,
  PAYMENT_ALREADY_FINAL: 409,
  INVALID_CREDENTIALS: 401,
  NOT_FOUND: 404,
  EMPTY_ORDER: 400,
  INVALID_STATUS_TRANSITION: 400,
  NOT_CONFIGURED: 503,
  INVALID_SOURCE: 400,
};

export function createApp(deps: AppDeps) {
  const { repos, paymentProvider, verifyGoogleToken, jwtSecret, corsOrigins, runInTransaction } = deps;

  const auth = createAuthService({ users: repos.users, jwtSecret, verifyGoogleToken });
  const catalog = createCatalogService({ products: repos.products });
  const orders = createOrdersService({ products: repos.products, orders: repos.orders, runInTransaction });
  const payments = createPaymentsService({ payments: repos.payments, orders: repos.orders, provider: paymentProvider });
  const socials = createSocialsService({ scans: repos.scans });

  const app = new Hono<AuthEnv>();

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

  app.use('/api/*', cors({ origin: corsOrigins, allowHeaders: ['Content-Type', 'Authorization'] }));

  app.get('/api/health', (c) => c.json({ status: 'ok' }));
  app.route('/api/auth', authRoutes(auth, jwtSecret));
  app.route('/api', catalogRoutes(catalog, repos.wishlist, jwtSecret));
  app.route('/api', orderRoutes(orders, jwtSecret));
  app.route('/api/payments', paymentRoutes(payments));
  app.route('/api/socials', socialsRoutes(socials, jwtSecret));
  app.route(
    '/api/admin',
    adminRoutes({
      products: repos.products,
      orders: repos.orders,
      payments: repos.payments,
      users: repos.users,
      ordersService: orders,
      jwtSecret,
    }),
  );

  return app;
}
