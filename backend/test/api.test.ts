import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeGoogleVerifier, FakeObjectStore, FakePaymentProvider, Fakes, FakeSmsProvider, fakeTx, makeFakes, seedCatalog, seedSetProduct } from './fakes';

const SECRET = 'api-test-secret';

const post = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const withMethod = (method: string, body?: unknown, token?: string) => ({
  method,
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  ...(body === undefined ? {} : { body: JSON.stringify(body) }),
});
const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

const CUSTOMER = {
  email: 'guest@example.com',
  phone: '+91 98765 43210',
  firstName: 'Guest',
  lastName: 'Shopper',
  addressLine1: '12 Marine Drive',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
  country: 'India',
};

describe('API', () => {
  let app: ReturnType<typeof createApp>;
  let f: Fakes;
  let seeded: Awaited<ReturnType<typeof seedCatalog>>;
  let adminToken: string;

  const sageM = () => seeded.sage.variants[0]; // stock 3
  const sageCustom = () => seeded.sage.variants[1]; // stock 50
  const mossS = () => seeded.moss.variants[0]; // stock 1

  async function registerCustomer(email = 'aanya@example.com') {
    const res = await app.request('/api/auth/register', post({ email, password: 'Aanya@2026', firstName: 'Aanya', lastName: 'Mehra' }));
    expect(res.status).toBe(201);
    return res.json() as Promise<{ token: string; user: { id: string; email: string } }>;
  }

  /** The admin catalogue keyed by id — how bulk edits are checked after the fact. */
  async function adminProductsById(): Promise<Record<string, any>> {
    const list = await (await app.request('/api/admin/products', bearer(adminToken))).json();
    return Object.fromEntries(list.map((p: any) => [p.id, p]));
  }

  async function placeOrder(items: { variantId: string; quantity: number }[], token?: string) {
    const res = await app.request('/api/orders', post({ customer: CUSTOMER, deliveryMethod: 'standard', items }, token));
    expect(res.status).toBe(201);
    return res.json() as Promise<any>;
  }

  beforeEach(async () => {
    f = makeFakes();
    seeded = await seedCatalog(f.products);
    await f.users.create({
      email: 'admin@tanviagnihotry.com',
      passwordHash: await bcrypt.hash('TanviAdmin@2026', 4),
      firstName: 'Tanvi',
      lastName: 'Agnihotry',
      role: 'admin',
    });
    app = createApp({
      repos: f,
      paymentProvider: new FakePaymentProvider(),
      objectStore: new FakeObjectStore(),
      jwtSecret: SECRET,
      corsOrigins: ['http://localhost:5173'],
      runInTransaction: fakeTx,
    });
    const login = await app.request('/api/auth/login', post({ email: 'admin@tanviagnihotry.com', password: 'TanviAdmin@2026' }));
    adminToken = (await login.json()).token;
  });

  describe('health & errors', () => {
    it('GET /api/health', async () => {
      const res = await app.request('/api/health');
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({ status: 'ok' });
    });

    it('unknown routes return {error} 404', async () => {
      const res = await app.request('/api/nope');
      expect(res.status).toBe(404);
      expect(await res.json()).toEqual({ error: 'Not found' });
    });

    it('malformed JSON bodies return 400 {error}, not 500', async () => {
      for (const path of ['/api/auth/register', '/api/orders', '/api/payments/confirm']) {
        const res = await app.request(path, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: '{"broken":',
        });
        expect(res.status).toBe(400);
        expect(typeof (await res.json()).error).toBe('string');
      }
    });
  });

  describe('auth', () => {
    it('registers, returns 201 {token,user} without passwordHash', async () => {
      const { token, user } = await registerCustomer();
      expect(token).toBeTruthy();
      expect(user).toMatchObject({ email: 'aanya@example.com', firstName: 'Aanya', role: 'customer' });
      expect(user).not.toHaveProperty('passwordHash');
    });

    it('409 on duplicate email', async () => {
      await registerCustomer();
      const res = await app.request('/api/auth/register', post({ email: 'aanya@example.com', password: 'Other@2026', firstName: 'X' }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/already exists/);
    });

    it('400 with {error:string} on invalid register bodies', async () => {
      for (const body of [
        { email: 'not-an-email', password: 'Aanya@2026', firstName: 'A' },
        { email: 'a@b.com', password: 'short', firstName: 'A' },
        { email: 'a@b.com', password: 'Aanya@2026' },
      ]) {
        const res = await app.request('/api/auth/register', post(body));
        expect(res.status).toBe(400);
        expect(typeof (await res.json()).error).toBe('string');
      }
    });

    it('logs in and rejects bad credentials with 401', async () => {
      await registerCustomer();
      const ok = await app.request('/api/auth/login', post({ email: 'aanya@example.com', password: 'Aanya@2026' }));
      expect(ok.status).toBe(200);
      expect((await ok.json()).user.email).toBe('aanya@example.com');
      const bad = await app.request('/api/auth/login', post({ email: 'aanya@example.com', password: 'nope-wrong' }));
      expect(bad.status).toBe(401);
    });

    it('GET /api/auth/me requires a valid Bearer token', async () => {
      expect((await app.request('/api/auth/me')).status).toBe(401);
      expect((await app.request('/api/auth/me', bearer('garbage'))).status).toBe(401);
      const { token, user } = await registerCustomer();
      const res = await app.request('/api/auth/me', bearer(token));
      expect(res.status).toBe(200);
      expect((await res.json()).user).toEqual(user);
    });
  });

  describe('google sign-in', () => {
    let google: FakeGoogleVerifier;
    let googleApp: ReturnType<typeof createApp>;

    beforeEach(() => {
      google = new FakeGoogleVerifier();
      googleApp = createApp({
        repos: f,
        paymentProvider: new FakePaymentProvider(),
        objectStore: new FakeObjectStore(),
        verifyGoogleToken: google.verify,
        jwtSecret: SECRET,
        corsOrigins: ['http://localhost:5173'],
        runInTransaction: fakeTx,
      });
    });

    it('503 while GOOGLE_CLIENT_ID is unset (masked)', async () => {
      const res = await app.request('/api/auth/google', post({ credential: 'anything' }));
      expect(res.status).toBe(503);
      expect(await res.json()).toEqual({ error: 'Google sign-in is not configured yet' });
    });

    it('400 on a missing credential', async () => {
      expect((await googleApp.request('/api/auth/google', post({}))).status).toBe(400);
    });

    it('creates a google user and our JWT works on /api/auth/me', async () => {
      google.issue('cred-riya', { email: 'riya@example.com', givenName: 'Riya', familyName: 'Kapoor' });
      const res = await googleApp.request('/api/auth/google', post({ credential: 'cred-riya' }));
      expect(res.status).toBe(200);
      const { token, user } = await res.json();
      expect(user).toMatchObject({ email: 'riya@example.com', firstName: 'Riya', lastName: 'Kapoor', role: 'customer' });
      expect(user).not.toHaveProperty('passwordHash');
      expect(f.users.users.find((u) => u.email === 'riya@example.com')).toMatchObject({
        authProvider: 'google',
        passwordHash: null,
      });

      const me = await googleApp.request('/api/auth/me', bearer(token));
      expect(me.status).toBe(200);
      expect((await me.json()).user).toEqual(user);
    });

    it('logs an existing password account in through google (no duplicate)', async () => {
      const { user: registered } = await registerCustomer();
      google.issue('cred-aanya', { email: 'aanya@example.com', givenName: 'Aanya', familyName: 'Mehra' });
      const res = await googleApp.request('/api/auth/google', post({ credential: 'cred-aanya' }));
      expect(res.status).toBe(200);
      expect((await res.json()).user.id).toBe(registered.id);
      expect(f.users.users.filter((u) => u.email === 'aanya@example.com')).toHaveLength(1);
    });

    it('401 {error:"Google sign-in failed"} on an invalid credential', async () => {
      const res = await googleApp.request('/api/auth/google', post({ credential: 'forged' }));
      expect(res.status).toBe(401);
      expect(await res.json()).toEqual({ error: 'Google sign-in failed' });
    });

    it('password login against a google-only account is 401, not a crash', async () => {
      google.issue('cred-riya', { email: 'riya@example.com', givenName: 'Riya', familyName: '' });
      await googleApp.request('/api/auth/google', post({ credential: 'cred-riya' }));
      const res = await googleApp.request('/api/auth/login', post({ email: 'riya@example.com', password: 'whatever1' }));
      expect(res.status).toBe(401);
    });

    it('registering over a google email is 409', async () => {
      google.issue('cred-riya', { email: 'riya@example.com', givenName: 'Riya', familyName: '' });
      await googleApp.request('/api/auth/google', post({ credential: 'cred-riya' }));
      const res = await googleApp.request(
        '/api/auth/register',
        post({ email: 'riya@example.com', password: 'Riya@2026', firstName: 'Riya' }),
      );
      expect(res.status).toBe(409);
    });
  });

  describe('catalog', () => {
    it('lists categories with product counts', async () => {
      const res = await app.request('/api/categories');
      expect(res.status).toBe(200);
      const cats = await res.json();
      expect(cats.map((c: any) => c.slug)).toEqual(['lehenga-sets', 'gowns']);
      expect(cats[0].productCount).toBe(2);
    });

    it('lists products as {items,total,page,pages}, excluding inactive', async () => {
      const res = await app.request('/api/products');
      const body = await res.json();
      expect(body).toMatchObject({ total: 3, page: 1, pages: 1 });
      expect(body.items.map((p: any) => p.slug)).not.toContain('archived-lehenga');
    });

    it('supports category, search, sort and pagination query params', async () => {
      const cat = await (await app.request('/api/products?category=gowns')).json();
      expect(cat.items.map((p: any) => p.slug)).toEqual(['moss-tissue-draped-gown']);

      const search = await (await app.request('/api/products?search=sequin')).json();
      expect(search.items.map((p: any) => p.slug)).toEqual(['sage-sequin-jacket-lehenga']);

      const sorted = await (await app.request('/api/products?sort=price_asc')).json();
      expect(sorted.items.map((p: any) => p.price)).toEqual([9600000, 16800000, 18400000]);

      const paged = await (await app.request('/api/products?limit=2&page=2')).json();
      expect(paged.items).toHaveLength(1);
      expect(paged).toMatchObject({ page: 2, pages: 2, total: 3 });
    });

    it('search ANDs tokens across name, craft, fabric and category name', async () => {
      // Two tokens: "sage" (name) + "lehenga" (name/category) — the other
      // Lehenga Sets pieces must not ride along on the category hit alone.
      const tokened = await (await app.request('/api/products?search=sage%20lehenga')).json();
      expect(tokened.items.map((p: any) => p.slug)).toEqual(['sage-sequin-jacket-lehenga']);

      // Craft/fabric hits — neither word appears in name/description/color.
      await f.products.updateProduct(seeded.plain.id, { craft: 'Aari', fabric: 'Organza' });
      const craft = await (await app.request('/api/products?search=aari')).json();
      expect(craft.items.map((p: any) => p.slug)).toEqual(['celadon-tissue-draped-lehenga']);
      const fabric = await (await app.request('/api/products?search=organza')).json();
      expect(fabric.items.map((p: any) => p.slug)).toEqual(['celadon-tissue-draped-lehenga']);

      // Category-name hit: "gowns" only exists on the category, never the piece.
      const catName = await (await app.request('/api/products?search=gowns')).json();
      expect(catName.items.map((p: any) => p.slug)).toEqual(['moss-tissue-draped-gown']);
    });

    it('rejects an invalid sort with 400', async () => {
      expect((await app.request('/api/products?sort=zalgo')).status).toBe(400);
    });

    it('returns product detail with variants and related', async () => {
      const res = await app.request('/api/products/sage-sequin-jacket-lehenga');
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.name).toBe('Sage Sequin Jacket Lehenga');
      expect(body.variants.map((v: any) => v.size)).toEqual(['M', 'Custom']);
      expect(body.related.map((p: any) => p.slug)).toEqual(['celadon-tissue-draped-lehenga']);
    });

    it('404s unknown and inactive product slugs', async () => {
      expect((await app.request('/api/products/ghost')).status).toBe(404);
      expect((await app.request('/api/products/archived-lehenga')).status).toBe(404);
    });

    it('lists distinct collections of active products and filters by collection', async () => {
      await seedSetProduct(f.products, seeded.lehengas.id); // collection: The Verdant Edit
      const collections = await (await app.request('/api/collections')).json();
      expect(collections).toEqual(['The Verdant Edit']);

      const filtered = await (
        await app.request(`/api/products?collection=${encodeURIComponent('The Verdant Edit')}`)
      ).json();
      expect(filtered.items.map((p: any) => p.slug)).toEqual(['fern-zardozi-set-fern']);
      expect(filtered.total).toBe(1);

      const none = await (await app.request('/api/products?collection=Nope')).json();
      expect(none.total).toBe(0);
    });

    it('filters by colour family server-side and 400s an unknown token', async () => {
      // The fixtures are all greens; add a pink piece through the admin route so
      // its family comes from the same keyword mapping the shop filters on.
      const created = await app.request(
        '/api/admin/products',
        withMethod('POST', {
          categorySlug: 'gowns',
          name: 'Blush Chiffon Gown',
          price: 8800000,
          color: 'Blush',
          active: true, // new pieces default to hidden — this one must be publicly visible
        }, adminToken),
      );
      expect((await created.json()).colorFamily).toBe('pink');

      const pink = await (await app.request('/api/products?color=pink')).json();
      expect(pink.items.map((p: any) => p.slug)).toEqual(['blush-chiffon-gown-blush']);
      expect(pink.items[0].colorFamily).toBe('pink');

      const green = await (await app.request('/api/products?color=green')).json();
      expect(green.total).toBe(3); // the three active fixtures
      expect((await (await app.request('/api/products?color=purple')).json()).total).toBe(0);
      expect((await app.request('/api/products?color=zalgo')).status).toBe(400);
    });

    it('exposes set-includes pricing fields on summaries and detail', async () => {
      const set = await seedSetProduct(f.products, seeded.lehengas.id);
      const list = await (await app.request('/api/products?search=zardozi')).json();
      const summary = list.items.find((p: any) => p.id === set.id);
      expect(summary).toMatchObject({ dupattaPrice: 1200000, jacketPrice: 2400000, collection: 'The Verdant Edit' });

      const detail = await (await app.request('/api/products/fern-zardozi-set-fern')).json();
      expect(detail).toMatchObject({ craft: 'Zardozi', fabric: 'Tissue', occasion: 'Wedding' });
    });
  });

  describe('orders', () => {
    it('creates a guest order priced server-side', async () => {
      const order = await placeOrder([{ variantId: sageM().id, quantity: 2 }]);
      expect(order.orderNumber).toMatch(/^TA-2026-\d{5}$/);
      expect(order).toMatchObject({ status: 'pending_payment', subtotal: 36800000, deliveryFee: 0, total: 36800000, userId: null });
    });

    it('409 on insufficient stock', async () => {
      const res = await app.request('/api/orders', post({ customer: CUSTOMER, deliveryMethod: 'standard', items: [{ variantId: mossS().id, quantity: 5 }] }));
      expect(res.status).toBe(409);
      expect((await res.json()).error).toMatch(/stock/i);
    });

    it('400 on empty items and invalid bodies', async () => {
      const empty = await app.request('/api/orders', post({ customer: CUSTOMER, deliveryMethod: 'standard', items: [] }));
      expect(empty.status).toBe(400);
      const invalid = await app.request('/api/orders', post({ customer: { ...CUSTOMER, email: 'nope' }, deliveryMethod: 'standard', items: [{ variantId: sageM().id, quantity: 1 }] }));
      expect(invalid.status).toBe(400);
    });

    it('charges priority delivery', async () => {
      const res = await app.request('/api/orders', post({ customer: CUSTOMER, deliveryMethod: 'priority', items: [{ variantId: sageM().id, quantity: 1 }] }));
      const order = await res.json();
      expect(order.deliveryFee).toBe(250000);
      expect(order.total).toBe(18400000 + 250000);
    });

    it('accepts a measurements note up to 500 chars and echoes it on the item', async () => {
      const note = 'bust 36 waist 30 '.padEnd(500, 'x'); // exactly the cap
      const res = await app.request('/api/orders', post({ customer: CUSTOMER, deliveryMethod: 'standard', items: [{ variantId: sageCustom().id, quantity: 1, measurements: note }] }));
      expect(res.status).toBe(201);
      const order = await res.json();
      expect(order.items[0].measurements).toBe(note);
    });

    it('400s a measurements note over 500 chars', async () => {
      const res = await app.request('/api/orders', post({ customer: CUSTOMER, deliveryMethod: 'standard', items: [{ variantId: sageCustom().id, quantity: 1, measurements: 'x'.repeat(501) }] }));
      expect(res.status).toBe(400);
    });

    it('attaches userId for Bearer orders and lists them under /api/me/orders', async () => {
      const { token, user } = await registerCustomer();
      const order = await placeOrder([{ variantId: sageM().id, quantity: 1 }], token);
      expect(order.userId).toBe(user.id);
      const res = await app.request('/api/me/orders', bearer(token));
      expect(res.status).toBe(200);
      const list = await res.json();
      expect(list).toHaveLength(1);
      expect(list[0].id).toBe(order.id);
    });

    it('GET /api/me/orders requires auth', async () => {
      expect((await app.request('/api/me/orders')).status).toBe(401);
    });

    it('guest tracking requires matching ?email=, matching Bearer, and never leaks', async () => {
      const { token } = await registerCustomer();
      const stranger = await registerCustomer('rhea@example.com');
      const order = await placeOrder([{ variantId: sageM().id, quantity: 1 }], token);

      expect((await app.request(`/api/orders/${order.orderNumber}?email=guest@example.com`)).status).toBe(200);
      expect((await app.request(`/api/orders/${order.orderNumber}`, bearer(token))).status).toBe(200);
      expect((await app.request(`/api/orders/${order.orderNumber}`)).status).toBe(404);
      expect((await app.request(`/api/orders/${order.orderNumber}?email=wrong@example.com`)).status).toBe(404);
      expect((await app.request(`/api/orders/${order.orderNumber}`, bearer(stranger.token))).status).toBe(404);
      expect((await app.request('/api/orders/TA-2026-99999?email=guest@example.com')).status).toBe(404);
    });
  });

  describe('phone otp', () => {
    let sms: FakeSmsProvider;
    let otpApp: ReturnType<typeof createApp>;

    beforeEach(() => {
      sms = new FakeSmsProvider();
      otpApp = createApp({
        repos: f,
        paymentProvider: new FakePaymentProvider(),
        objectStore: new FakeObjectStore(),
        smsProvider: sms,
        otpDevCode: '123456',
        jwtSecret: SECRET,
        corsOrigins: ['http://localhost:5173'],
        runInTransaction: fakeTx,
      });
    });

    it('503 while no SMS provider is configured (masked)', async () => {
      const res = await app.request('/api/auth/otp/request', post({ phone: '9876543210' }));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/not configured/);
    });

    it('400 on an invalid phone or malformed code', async () => {
      expect((await otpApp.request('/api/auth/otp/request', post({ phone: '12345678' }))).status).toBe(400);
      expect((await otpApp.request('/api/auth/otp/verify', post({ phone: '9876543210', code: 'abc123' }))).status).toBe(400);
    });

    it('request → verify issues a JWT that works on /api/auth/me', async () => {
      const req = await otpApp.request('/api/auth/otp/request', post({ phone: '98765 43210' }));
      expect(req.status).toBe(200);
      expect(await req.json()).toEqual({ phone: '+919876543210' });
      expect(sms.sent).toEqual([{ phone: '+919876543210', code: '123456' }]);

      const res = await otpApp.request('/api/auth/otp/verify', post({ phone: '9876543210', code: '123456' }));
      expect(res.status).toBe(200);
      const { token, user } = await res.json();
      expect(user).toMatchObject({ phone: '+919876543210', email: null, role: 'customer' });
      expect(user).not.toHaveProperty('passwordHash');

      const me = await otpApp.request('/api/auth/me', bearer(token));
      expect(me.status).toBe(200);
      expect((await me.json()).user).toEqual(user);
    });

    it('401 on a wrong code', async () => {
      await otpApp.request('/api/auth/otp/request', post({ phone: '9876543210' }));
      const res = await otpApp.request('/api/auth/otp/verify', post({ phone: '9876543210', code: '999999' }));
      expect(res.status).toBe(401);
    });
  });

  describe('payments', () => {
    it('checkout returns the masked Razorpay payload', async () => {
      const order = await placeOrder([{ variantId: sageM().id, quantity: 1 }]);
      const res = await app.request('/api/payments/checkout', post({ orderId: order.id, email: 'guest@example.com' }));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual({
        paymentId: expect.any(String),
        providerOrderId: expect.stringMatching(/^order_MOCK/),
        keyId: 'rzp_test_MASKED',
        amount: order.total,
        currency: 'INR',
        mock: true,
      });
    });

    it('checkout/confirm require the requester to own the order (guest email rule)', async () => {
      const order = await placeOrder([{ variantId: sageM().id, quantity: 1 }]);
      // No credentials and wrong email are indistinguishable from a missing order.
      expect((await app.request('/api/payments/checkout', post({ orderId: order.id }))).status).toBe(404);
      expect(
        (await app.request('/api/payments/checkout', post({ orderId: order.id, email: 'wrong@example.com' }))).status,
      ).toBe(404);
      const res = await app.request('/api/payments/checkout', post({ orderId: order.id, email: 'guest@example.com' }));
      expect(res.status).toBe(200);
      const { paymentId } = await res.json();
      expect((await app.request('/api/payments/confirm', post({ paymentId, outcome: 'success' }))).status).toBe(404);
      expect(
        (await app.request('/api/payments/confirm', post({ paymentId, outcome: 'success', email: 'wrong@example.com' }))).status,
      ).toBe(404);
      expect(
        (await app.request('/api/payments/confirm', post({ paymentId, outcome: 'success', email: 'guest@example.com' }))).status,
      ).toBe(200);
    });

    it('a signed-in owner pays via their token; other users are rejected', async () => {
      const { token } = await registerCustomer();
      const stranger = await registerCustomer('rhea@example.com');
      const order = await placeOrder([{ variantId: sageM().id, quantity: 1 }], token);
      expect((await app.request('/api/payments/checkout', post({ orderId: order.id }, stranger.token))).status).toBe(404);
      const res = await app.request('/api/payments/checkout', post({ orderId: order.id }, token));
      expect(res.status).toBe(200);
      const { paymentId } = await res.json();
      expect((await app.request('/api/payments/confirm', post({ paymentId, outcome: 'success' }, stranger.token))).status).toBe(404);
      expect((await app.request('/api/payments/confirm', post({ paymentId, outcome: 'success' }, token))).status).toBe(200);
    });

    it('404 for checkout on unknown order, 400 for bad confirm outcome', async () => {
      expect((await app.request('/api/payments/checkout', post({ orderId: 'ghost' }))).status).toBe(404);
      expect((await app.request('/api/payments/confirm', post({ paymentId: 'x', outcome: 'maybe' }))).status).toBe(400);
      expect((await app.request('/api/payments/confirm', post({ paymentId: 'ghost', outcome: 'success' }))).status).toBe(404);
    });

    it('confirm success captures payment and marks order paid', async () => {
      const order = await placeOrder([{ variantId: sageM().id, quantity: 1 }]);
      const { paymentId } = await (await app.request('/api/payments/checkout', post({ orderId: order.id, email: 'guest@example.com' }))).json();
      const res = await app.request('/api/payments/confirm', post({ paymentId, outcome: 'success', email: 'guest@example.com' }));
      expect(res.status).toBe(200);
      const body = await res.json();
      expect(body.payment.status).toBe('captured');
      expect(body.payment.providerPaymentId).toMatch(/^pay_MOCK/);
      expect(body.order.status).toBe('paid');
      const tracked = await (await app.request(`/api/orders/${order.orderNumber}?email=guest@example.com`)).json();
      expect(tracked.status).toBe('paid');
    });

    it('confirm failure leaves the order retryable', async () => {
      const order = await placeOrder([{ variantId: sageM().id, quantity: 1 }]);
      const { paymentId } = await (await app.request('/api/payments/checkout', post({ orderId: order.id, email: 'guest@example.com' }))).json();
      const res = await app.request('/api/payments/confirm', post({ paymentId, outcome: 'failure', email: 'guest@example.com' }));
      const body = await res.json();
      expect(body.payment.status).toBe('failed');
      expect(body.order.status).toBe('pending_payment');
      // retry via a fresh checkout succeeds
      const retry = await (await app.request('/api/payments/checkout', post({ orderId: order.id, email: 'guest@example.com' }))).json();
      const done = await (await app.request('/api/payments/confirm', post({ paymentId: retry.paymentId, outcome: 'success', email: 'guest@example.com' }))).json();
      expect(done.order.status).toBe('paid');
    });

    it('second confirm is idempotent; checkout after capture is 409', async () => {
      const order = await placeOrder([{ variantId: sageM().id, quantity: 1 }]);
      const { paymentId } = await (await app.request('/api/payments/checkout', post({ orderId: order.id, email: 'guest@example.com' }))).json();
      const first = await (await app.request('/api/payments/confirm', post({ paymentId, outcome: 'success', email: 'guest@example.com' }))).json();
      const again = await app.request('/api/payments/confirm', post({ paymentId, outcome: 'success', email: 'guest@example.com' }));
      expect(again.status).toBe(200);
      expect((await again.json()).payment).toEqual(first.payment);
      expect((await app.request('/api/payments/checkout', post({ orderId: order.id, email: 'guest@example.com' }))).status).toBe(409);
    });
  });

  describe('wishlist', () => {
    it('requires auth', async () => {
      expect((await app.request('/api/me/wishlist')).status).toBe(401);
      expect((await app.request('/api/me/wishlist/x', withMethod('PUT'))).status).toBe(401);
      expect((await app.request('/api/me/wishlist/x', withMethod('DELETE'))).status).toBe(401);
    });

    it('adds (idempotently), lists and removes products', async () => {
      const { token } = await registerCustomer();
      const added = await app.request(`/api/me/wishlist/${seeded.sage.id}`, withMethod('PUT', undefined, token));
      expect(added.status).toBe(200);
      expect((await added.json()).map((p: any) => p.slug)).toEqual(['sage-sequin-jacket-lehenga']);

      await app.request(`/api/me/wishlist/${seeded.sage.id}`, withMethod('PUT', undefined, token));
      await app.request(`/api/me/wishlist/${seeded.moss.id}`, withMethod('PUT', undefined, token));
      const list = await (await app.request('/api/me/wishlist', bearer(token))).json();
      expect(list).toHaveLength(2);
      expect(list[0].slug).toBe('moss-tissue-draped-gown'); // newest first

      const removed = await app.request(`/api/me/wishlist/${seeded.sage.id}`, withMethod('DELETE', undefined, token));
      expect((await removed.json()).map((p: any) => p.slug)).toEqual(['moss-tissue-draped-gown']);
    });

    it('404s adding an unknown product and isolates users', async () => {
      const { token } = await registerCustomer();
      expect((await app.request('/api/me/wishlist/ghost', withMethod('PUT', undefined, token))).status).toBe(404);
      const other = await registerCustomer('rhea@example.com');
      await app.request(`/api/me/wishlist/${seeded.sage.id}`, withMethod('PUT', undefined, token));
      expect(await (await app.request('/api/me/wishlist', bearer(other.token))).json()).toEqual([]);
    });
  });

  describe('admin', () => {
    it('guards every admin route: 401 anonymous, 403 customer', async () => {
      const { token: customerToken } = await registerCustomer();
      for (const [path, init] of [
        ['/api/admin/summary', undefined],
        ['/api/admin/products', undefined],
        ['/api/admin/orders', undefined],
        ['/api/admin/payments', undefined],
        ['/api/admin/users', undefined],
      ] as const) {
        expect((await app.request(path, init)).status).toBe(401);
        expect((await app.request(path, bearer(customerToken))).status).toBe(403);
      }
    });

    it('lists all products including inactive ones', async () => {
      const res = await app.request('/api/admin/products', bearer(adminToken));
      expect(res.status).toBe(200);
      const items = await res.json();
      expect(items.map((p: any) => p.slug)).toContain('archived-lehenga');
      expect(items[0].variants.length).toBeGreaterThan(0);
      expect(items[0]).toHaveProperty('active');
      expect(items[0]).toHaveProperty('categorySlug');
    });

    it('creates and updates products, sets variant stock', async () => {
      const created = await app.request(
        '/api/admin/products',
        withMethod('POST', {
          categoryId: seeded.gowns.id,
          slug: 'fern-pleated-tissue-gown',
          name: 'Fern Pleated Tissue Gown',
          price: 11200000,
          color: 'Fern',
          flag: 'new',
          variants: [{ size: 'M', stock: 4 }],
        }, adminToken),
      );
      expect(created.status).toBe(201);
      const product = await created.json();
      expect(product).toMatchObject({ slug: 'fern-pleated-tissue-gown', categorySlug: 'gowns', flag: 'new' });

      const updated = await app.request(`/api/admin/products/${product.id}`, withMethod('PUT', { price: 11800000, active: false }, adminToken));
      expect(updated.status).toBe(200);
      expect(await updated.json()).toMatchObject({ price: 11800000, active: false });

      const variantId = product.variants[0].id;
      const patched = await app.request(`/api/admin/variants/${variantId}`, withMethod('PATCH', { stock: 9 }, adminToken));
      expect(patched.status).toBe(200);
      expect(await patched.json()).toMatchObject({ id: variantId, stock: 9 });

      expect((await app.request('/api/admin/products/ghost', withMethod('PUT', { price: 1 }, adminToken))).status).toBe(404);
      expect((await app.request('/api/admin/variants/ghost', withMethod('PATCH', { stock: 1 }, adminToken))).status).toBe(404);
      expect((await app.request(`/api/admin/variants/${variantId}`, withMethod('PATCH', { stock: -2 }, adminToken))).status).toBe(400);
      expect((await app.request('/api/admin/products', withMethod('POST', { categoryId: 'ghost', slug: 'x', name: 'X', price: 1 }, adminToken))).status).toBe(404);
    });

    it('409s on a duplicate slug the admin asked for by hand', async () => {
      const dupCreate = await app.request(
        '/api/admin/products',
        withMethod('POST', {
          categoryId: seeded.lehengas.id,
          slug: 'sage-sequin-jacket-lehenga', // taken by the fixture
          name: 'Copycat',
          price: 100,
        }, adminToken),
      );
      expect(dupCreate.status).toBe(409);
      expect((await dupCreate.json()).error).toMatch(/slug/i);
    });

    it('derives the slug from name + colour and uniquifies it on a collision', async () => {
      const body = (over: Record<string, unknown> = {}) => ({
        categoryId: seeded.gowns.id,
        name: 'Fern Pleated Gown',
        price: 11200000,
        color: 'Fern',
        ...over,
      });
      const first = await app.request('/api/admin/products', withMethod('POST', body(), adminToken));
      expect(first.status).toBe(201);
      expect((await first.json()).slug).toBe('fern-pleated-gown-fern');

      // Same name + colour again: the route walks base-2…base-6 instead of 409ing.
      const second = await app.request('/api/admin/products', withMethod('POST', body(), adminToken));
      expect(second.status).toBe(201);
      expect((await second.json()).slug).toBe('fern-pleated-gown-fern-2');

      const third = await app.request('/api/admin/products', withMethod('POST', body(), adminToken));
      expect((await third.json()).slug).toBe('fern-pleated-gown-fern-3');
    });

    it('never changes a slug on PUT, even when one is sent', async () => {
      const res = await app.request(
        `/api/admin/products/${seeded.moss.id}`,
        withMethod('PUT', { slug: 'sage-sequin-jacket-lehenga', name: 'Moss Tissue Draped Gown II' }, adminToken),
      );
      expect(res.status).toBe(200);
      const product = await res.json();
      expect(product.slug).toBe('moss-tissue-draped-gown');
      expect(product.name).toBe('Moss Tissue Draped Gown II');
    });

    it('validates sale pricing on create and clears it when the sale ends', async () => {
      const saleBody = (over: Record<string, unknown> = {}) => ({
        categoryId: seeded.gowns.id,
        name: 'Sale Gown',
        price: 10000000,
        color: 'Blush Pink',
        flag: 'sale',
        ...over,
      });
      // flag sale without a sale price, and a sale price that is not a discount.
      expect((await app.request('/api/admin/products', withMethod('POST', saleBody(), adminToken))).status).toBe(400);
      expect(
        (await app.request('/api/admin/products', withMethod('POST', saleBody({ salePrice: 10000000 }), adminToken)))
          .status,
      ).toBe(400);
      // A sale price without the sale flag is refused too.
      expect(
        (await app.request('/api/admin/products', withMethod('POST', saleBody({ flag: null, salePrice: 900 }), adminToken)))
          .status,
      ).toBe(400);

      const created = await app.request(
        '/api/admin/products',
        withMethod('POST', saleBody({ salePrice: 7500000 }), adminToken),
      );
      expect(created.status).toBe(201);
      const product = await created.json();
      expect(product).toMatchObject({ flag: 'sale', salePrice: 7500000, colorFamily: 'pink' });

      // PUT keeps the same guard…
      const badUpdate = await app.request(
        `/api/admin/products/${product.id}`,
        withMethod('PUT', { flag: 'sale', price: 10000000, salePrice: 12000000 }, adminToken),
      );
      expect(badUpdate.status).toBe(400);

      // …and leaving the sale wipes the stale discount.
      const ended = await app.request(`/api/admin/products/${product.id}`, withMethod('PUT', { flag: null }, adminToken));
      expect(ended.status).toBe(200);
      expect(await ended.json()).toMatchObject({ flag: null, salePrice: null });
    });

    it('creates new pieces hidden by default — never live on the boutique (TA-004)', async () => {
      const created = await app.request(
        '/api/admin/products',
        withMethod('POST', {
          categorySlug: 'gowns',
          name: 'Half Finished Gown',
          price: 7700000,
          color: 'Sage',
        }, adminToken),
      );
      expect(created.status).toBe(201);
      const product = await created.json();
      expect(product.active).toBe(false);

      // Invisible to the storefront until explicitly published.
      const pub = await (await app.request('/api/products?search=Half%20Finished')).json();
      expect(pub.items).toHaveLength(0);
    });

    it('keeps costPrice on the admin product and off both public reads', async () => {
      const created = await app.request(
        '/api/admin/products',
        withMethod('POST', {
          categorySlug: 'gowns',
          name: 'Cost Gown',
          price: 9900000,
          color: 'Sage',
          costPrice: 4200000,
          active: true,
        }, adminToken),
      );
      expect(created.status).toBe(201);
      const product = await created.json();
      expect(product.costPrice).toBe(4200000);

      const adminList = await (await app.request('/api/admin/products', bearer(adminToken))).json();
      expect(adminList.find((p: any) => p.id === product.id).costPrice).toBe(4200000);

      const detail = await (await app.request(`/api/products/${product.slug}`)).json();
      expect(detail.id).toBe(product.id);
      expect(detail).not.toHaveProperty('costPrice');

      const list = await (await app.request('/api/products?search=Cost%20Gown')).json();
      expect(list.items).toHaveLength(1);
      expect(list.items[0]).not.toHaveProperty('costPrice');
    });

    it('round-trips an ordered gallery and keeps imageUrl on images[0]', async () => {
      const created = await app.request(
        '/api/admin/products',
        withMethod('POST', {
          categorySlug: 'gowns',
          name: 'Gallery Gown',
          price: 9900000,
          color: 'Sage',
          active: true,
          imageUrl: 'https://cdn.test/legacy.jpg', // a gallery always wins
          images: [
            { url: 'https://cdn.test/a.jpg', pose: 'front' },
            { url: 'https://cdn.test/b.jpg' },
            { url: 'https://cdn.test/c.jpg', pose: 'detail' },
          ],
        }, adminToken),
      );
      expect(created.status).toBe(201);
      const product = await created.json();
      expect(product.images).toEqual([
        { url: 'https://cdn.test/a.jpg', pose: 'front' },
        { url: 'https://cdn.test/b.jpg', pose: '' },
        { url: 'https://cdn.test/c.jpg', pose: 'detail' },
      ]);
      expect(product.imageUrl).toBe('https://cdn.test/a.jpg');

      const summary = (await (await app.request('/api/products?search=Gallery')).json()).items[0];
      expect(summary.imageUrl).toBe(product.images[0].url);

      // Reordering is a wholesale replace, primary photo included.
      const reordered = await app.request(
        `/api/admin/products/${product.id}`,
        withMethod('PUT', {
          images: [
            { url: 'https://cdn.test/c.jpg', pose: 'detail' },
            { url: 'https://cdn.test/a.jpg', pose: 'front' },
          ],
        }, adminToken),
      );
      expect(reordered.status).toBe(200);
      const after = await reordered.json();
      expect(after.images.map((i: any) => i.url)).toEqual(['https://cdn.test/c.jpg', 'https://cdn.test/a.jpg']);
      expect(after.imageUrl).toBe('https://cdn.test/c.jpg');

      const publicDetail = await (await app.request(`/api/products/${product.slug}`)).json();
      expect(publicDetail.images.map((i: any) => i.pose)).toEqual(['detail', 'front']);
    });

    it('names the uploaded photo through the catalog AI, falling back to a uuid key', async () => {
      const withAi = (catalogAi: any) =>
        createApp({
          repos: f,
          paymentProvider: new FakePaymentProvider(),
          objectStore: new FakeObjectStore(),
          jwtSecret: SECRET,
          corsOrigins: [],
          runInTransaction: fakeTx,
          catalogAi,
        });
      const presign = (target: ReturnType<typeof createApp>, body: Record<string, unknown>) =>
        target.request('/api/admin/uploads/product-image', post(body, adminToken));
      const named = {
        contentType: 'image/jpeg',
        productName: 'Sage Sequin Jacket Lehenga',
        imageBase64: Buffer.from([0xff, 0xd8, 0xff, 0xe0]).toString('base64'),
      };

      const naming = withAi({
        colorFamily: async () => null,
        nameProductImage: async () => ({ fileSlug: 'Sage Sequin  Lehenga — Front!', pose: 'front' }),
      });
      const res = await presign(naming, named);
      expect(res.status).toBe(201);
      const body = await res.json();
      expect(body.key).toMatch(/^products\/\d{4}\/\d{2}\/sage-sequin-lehenga-front-[0-9a-f]{6}\.jpg$/);
      expect(body.pose).toBe('front');
      expect(body.publicUrl).toContain(encodeURIComponent(body.key));

      // Unusable name, thrown error, and no AI at all: the uuid key, pose null.
      const uuidKey = /^products\/\d{4}\/\d{2}\/[0-9a-f-]{36}\.jpg$/;
      for (const catalogAi of [
        { colorFamily: async () => null, nameProductImage: async () => null },
        { colorFamily: async () => null, nameProductImage: async () => ({ fileSlug: '!!!', pose: null }) },
        {
          colorFamily: async () => null,
          nameProductImage: async () => {
            throw new Error('anthropic exploded');
          },
        },
        null,
      ]) {
        const fallback = await (await presign(withAi(catalogAi), named)).json();
        expect(fallback.key).toMatch(uuidKey);
        expect(fallback.pose).toBeNull();
      }

      // Naming fields are all-or-nothing, and a plain presign still answers.
      expect((await presign(naming, { contentType: 'image/jpeg', productName: 'X' })).status).toBe(400);
      const plain = await (await presign(naming, { contentType: 'image/jpeg' })).json();
      expect(plain.key).toMatch(uuidKey);
      expect(plain.pose).toBeNull();
    });

    it('bulk-deletes products: hard-deletes unordered, archives ordered, reports unknowns', async () => {
      await placeOrder([{ variantId: sageM().id, quantity: 1 }]); // sage becomes archive-only
      const res = await app.request(
        '/api/admin/products/bulk-delete',
        withMethod('POST', { ids: [seeded.sage.id, seeded.plain.id, 'ghost'] }, adminToken),
      );
      expect(res.status).toBe(200);
      const { results } = await res.json();
      expect(results).toEqual(
        expect.arrayContaining([
          { id: seeded.sage.id, outcome: 'archived' },
          { id: seeded.plain.id, outcome: 'deleted' },
          { id: 'ghost', outcome: 'not_found' },
        ]),
      );

      // Both vanish from the admin list and the storefront…
      const adminList = await (await app.request('/api/admin/products', bearer(adminToken))).json();
      const adminIds = adminList.map((p: any) => p.id);
      expect(adminIds).not.toContain(seeded.sage.id);
      expect(adminIds).not.toContain(seeded.plain.id);
      expect((await app.request('/api/products/celadon-tissue-draped-lehenga')).status).toBe(404);
      expect((await app.request('/api/products/sage-sequin-jacket-lehenga')).status).toBe(404);

      // …but the archived product's order history is intact.
      const orders = await (await app.request('/api/admin/orders', bearer(adminToken))).json();
      expect(orders[0].items[0].productName).toBe('Sage Sequin Jacket Lehenga');

      // Gating: anonymous and customer requests are rejected.
      expect((await app.request('/api/admin/products/bulk-delete', withMethod('POST', { ids: ['x'] }))).status).toBe(401);
      // Empty list is a validation error.
      expect((await app.request('/api/admin/products/bulk-delete', withMethod('POST', { ids: [] }, adminToken))).status).toBe(400);
    });

    it('bulk-puts pieces on sale at a percentage off each piece\'s own price', async () => {
      const res = await app.request(
        '/api/admin/products/bulk-update',
        withMethod('POST', {
          ids: [seeded.sage.id, seeded.moss.id, 'ghost'],
          action: { type: 'sale', discountPct: 20 },
        }, adminToken),
      );
      expect(res.status).toBe(200);
      expect((await res.json()).results).toEqual(
        expect.arrayContaining([
          { id: seeded.sage.id, outcome: 'updated' },
          { id: seeded.moss.id, outcome: 'updated' },
          { id: 'ghost', outcome: 'not_found' },
        ]),
      );

      // 20% off ₹1,84,000 and off ₹96,000 — one percentage, two different prices.
      const byId = await adminProductsById();
      expect(byId[seeded.sage.id]).toMatchObject({ flag: 'sale', salePrice: 14720000 });
      expect(byId[seeded.moss.id]).toMatchObject({ flag: 'sale', salePrice: 7680000 });
      // The list price is never overwritten, so the discount stays reversible.
      expect(byId[seeded.sage.id].price).toBe(18400000);
    });

    it('rounds a bulk sale to whole rupees and skips pieces it cannot discount', async () => {
      const make = async (name: string, price: number) =>
        (await (await app.request(
          '/api/admin/products',
          withMethod('POST', { categoryId: seeded.gowns.id, name, price, color: 'Test' }, adminToken),
        )).json()).id as string;
      const odd = await make('Odd Money Gown', 33333); // ₹333.33
      const penny = await make('Penny Swatch', 100); // ₹1

      const res = await app.request(
        '/api/admin/products/bulk-update',
        withMethod('POST', { ids: [odd, penny], action: { type: 'sale', discountPct: 10 } }, adminToken),
      );
      expect((await res.json()).results).toEqual(
        expect.arrayContaining([
          { id: odd, outcome: 'updated' },
          // ₹1 less 10% rounds straight back to ₹1 — not a discount, so it's left alone.
          { id: penny, outcome: 'skipped' },
        ]),
      );

      const byId = await adminProductsById();
      expect(byId[odd].salePrice).toBe(30000); // ₹299.997 → ₹300
      expect(byId[penny]).toMatchObject({ flag: null, salePrice: null });
    });

    it('ends a bulk sale only on pieces that are actually on sale', async () => {
      await app.request(
        '/api/admin/products/bulk-update',
        withMethod('POST', { ids: [seeded.sage.id], action: { type: 'sale', discountPct: 25 } }, adminToken),
      );

      const res = await app.request(
        '/api/admin/products/bulk-update',
        withMethod('POST', { ids: [seeded.sage.id, seeded.moss.id], action: { type: 'end_sale' } }, adminToken),
      );
      expect((await res.json()).results).toEqual(
        expect.arrayContaining([
          { id: seeded.sage.id, outcome: 'updated' },
          // Flagged 'new', never on sale — ending a sale must not strip that.
          { id: seeded.moss.id, outcome: 'skipped' },
        ]),
      );

      const byId = await adminProductsById();
      expect(byId[seeded.sage.id]).toMatchObject({ flag: null, salePrice: null });
      expect(byId[seeded.moss.id]).toMatchObject({ flag: 'new' });
    });

    it('bulk-hides pieces from the storefront and shows them again', async () => {
      const setVisible = (active: boolean) =>
        app.request(
          '/api/admin/products/bulk-update',
          withMethod('POST', { ids: [seeded.sage.id], action: { type: 'visibility', active } }, adminToken),
        );

      await setVisible(false);
      expect((await app.request('/api/products/sage-sequin-jacket-lehenga')).status).toBe(404);

      await setVisible(true);
      expect((await app.request('/api/products/sage-sequin-jacket-lehenga')).status).toBe(200);
    });

    it('clears a stale sale price when a bulk flag change takes a piece off sale', async () => {
      const bulk = (action: unknown) =>
        app.request(
          '/api/admin/products/bulk-update',
          withMethod('POST', { ids: [seeded.sage.id], action }, adminToken),
        );
      await bulk({ type: 'sale', discountPct: 20 });
      await bulk({ type: 'flag', flag: 'bestseller' });

      // Checkout charges the effective price, so a leftover sale_price would
      // keep discounting a piece that no longer advertises a sale.
      expect((await adminProductsById())[seeded.sage.id]).toMatchObject({
        flag: 'bestseller',
        salePrice: null,
      });
    });

    it('guards and validates bulk-update', async () => {
      const anon = await app.request(
        '/api/admin/products/bulk-update',
        withMethod('POST', { ids: ['x'], action: { type: 'end_sale' } }),
      );
      expect(anon.status).toBe(401);

      const bad = (body: unknown) =>
        app.request('/api/admin/products/bulk-update', withMethod('POST', body, adminToken));
      const ids = [seeded.sage.id];
      expect((await bad({ ids, action: { type: 'sale', discountPct: 0 } })).status).toBe(400);
      expect((await bad({ ids, action: { type: 'sale', discountPct: 96 } })).status).toBe(400);
      // 'sale' is not a settable flag — it needs a percentage, so it has its own action.
      expect((await bad({ ids, action: { type: 'flag', flag: 'sale' } })).status).toBe(400);
      expect((await bad({ ids, action: { type: 'nonsense' } })).status).toBe(400);
      expect((await bad({ ids: [], action: { type: 'end_sale' } })).status).toBe(400);
    });

    it('frees an archived product\'s slug for re-use', async () => {
      await placeOrder([{ variantId: sageM().id, quantity: 1 }]);
      await app.request('/api/admin/products/bulk-delete', withMethod('POST', { ids: [seeded.sage.id] }, adminToken));
      const recreated = await app.request(
        '/api/admin/products',
        withMethod('POST', {
          categoryId: seeded.lehengas.id,
          slug: 'sage-sequin-jacket-lehenga',
          name: 'Sage Sequin Jacket Lehenga II',
          price: 18400000,
        }, adminToken),
      );
      expect(recreated.status).toBe(201);
    });

    it('creates products by categorySlug as well as categoryId', async () => {
      const created = await app.request(
        '/api/admin/products',
        withMethod('POST', {
          categorySlug: 'gowns',
          slug: 'verify-gown',
          name: 'Verify Gown',
          price: 9900000,
          color: 'Sage',
          flag: null,
          imageUrl: null,
          active: true,
          variants: [{ size: 'S', stock: 3 }, { size: 'M', stock: 3 }],
        }, adminToken),
      );
      expect(created.status).toBe(201);
      expect(await created.json()).toMatchObject({ slug: 'verify-gown', categorySlug: 'gowns' });

      const unknownSlug = await app.request('/api/admin/products', withMethod('POST', { categorySlug: 'nope', slug: 'y', name: 'Y', price: 1 }, adminToken));
      expect(unknownSlug.status).toBe(404);
      const missingBoth = await app.request('/api/admin/products', withMethod('POST', { slug: 'z', name: 'Z', price: 1 }, adminToken));
      expect(missingBoth.status).toBe(400);
    });

    it('lists and filters orders, walks status transitions, cancel restocks', async () => {
      const a = await placeOrder([{ variantId: sageM().id, quantity: 2 }]);
      const b = await placeOrder([{ variantId: sageM().id, quantity: 1 }]);

      const all = await (await app.request('/api/admin/orders', bearer(adminToken))).json();
      expect(all).toHaveLength(2);
      const filtered = await (await app.request('/api/admin/orders?status=pending_payment', bearer(adminToken))).json();
      expect(filtered).toHaveLength(2);
      expect((await app.request('/api/admin/orders?status=bogus', bearer(adminToken))).status).toBe(400);

      const paid = await app.request(`/api/admin/orders/${a.id}`, withMethod('PATCH', { status: 'paid' }, adminToken));
      expect(paid.status).toBe(200);
      expect((await paid.json()).status).toBe('paid');
      const bad = await app.request(`/api/admin/orders/${a.id}`, withMethod('PATCH', { status: 'delivered' }, adminToken));
      expect(bad.status).toBe(400);
      expect((await app.request('/api/admin/orders/ghost', withMethod('PATCH', { status: 'paid' }, adminToken))).status).toBe(404);

      // cancel restocks: stock was 3 - 2 - 1 = 0; cancelling b (qty 1) returns it to 1
      const cancelled = await app.request(`/api/admin/orders/${b.id}`, withMethod('PATCH', { status: 'cancelled' }, adminToken));
      expect((await cancelled.json()).status).toBe('cancelled');
      const products = await (await app.request('/api/admin/products', bearer(adminToken))).json();
      const sage = products.find((p: any) => p.slug === 'sage-sequin-jacket-lehenga');
      expect(sage.variants.find((v: any) => v.size === 'M').stock).toBe(1);
    });

    it('lists payments with orderNumber', async () => {
      const order = await placeOrder([{ variantId: sageM().id, quantity: 1 }]);
      const { paymentId } = await (await app.request('/api/payments/checkout', post({ orderId: order.id, email: 'guest@example.com' }))).json();
      await app.request('/api/payments/confirm', post({ paymentId, outcome: 'success', email: 'guest@example.com' }));
      const res = await app.request('/api/admin/payments', bearer(adminToken));
      expect(res.status).toBe(200);
      const payments = await res.json();
      expect(payments).toHaveLength(1);
      expect(payments[0]).toMatchObject({
        source: 'gateway',
        status: 'captured',
        orderNumber: order.orderNumber,
        provider: 'razorpay_mock',
      });
    });

    it('lists users newest first with authProvider and ordersCount', async () => {
      const { token, user } = await registerCustomer();
      await placeOrder([{ variantId: sageM().id, quantity: 1 }], token);
      await placeOrder([{ variantId: sageM().id, quantity: 1 }], token);
      await placeOrder([{ variantId: sageM().id, quantity: 1 }]); // guest order — counts for nobody

      const res = await app.request('/api/admin/users', bearer(adminToken));
      expect(res.status).toBe(200);
      const list = await res.json();
      expect(list).toHaveLength(2);
      // newest first: the customer registered after the seeded admin
      expect(list.map((u: any) => u.email)).toEqual(['aanya@example.com', 'admin@tanviagnihotry.com']);
      expect(list[0]).toEqual({
        id: user.id,
        email: 'aanya@example.com',
        phone: null,
        firstName: 'Aanya',
        lastName: 'Mehra',
        role: 'customer',
        authProvider: 'password',
        createdAt: expect.any(String),
        ordersCount: 2,
      });
      expect(list[1]).toMatchObject({ role: 'admin', authProvider: 'password', ordersCount: 0 });
      expect(list[0]).not.toHaveProperty('passwordHash');
    });

    it('patches a user role, refuses self-demotion, 404s unknown ids', async () => {
      const { user } = await registerCustomer();

      const promoted = await app.request(`/api/admin/users/${user.id}`, withMethod('PATCH', { role: 'admin' }, adminToken));
      expect(promoted.status).toBe(200);
      expect(await promoted.json()).toMatchObject({ id: user.id, role: 'admin', authProvider: 'password', ordersCount: 0 });

      const demoted = await app.request(`/api/admin/users/${user.id}`, withMethod('PATCH', { role: 'customer' }, adminToken));
      expect((await demoted.json()).role).toBe('customer');

      const admin = (await (await app.request('/api/auth/me', bearer(adminToken))).json()).user;
      const self = await app.request(`/api/admin/users/${admin.id}`, withMethod('PATCH', { role: 'customer' }, adminToken));
      expect(self.status).toBe(400);
      expect(await self.json()).toEqual({ error: 'You cannot change your own role' });

      expect((await app.request('/api/admin/users/ghost', withMethod('PATCH', { role: 'admin' }, adminToken))).status).toBe(404);
      expect((await app.request(`/api/admin/users/${user.id}`, withMethod('PATCH', { role: 'superuser' }, adminToken))).status).toBe(400);
    });

    it('summary reports activeOrders, revenue, pendingPayments, lowStock and recentOrders', async () => {
      const paidOrder = await placeOrder([{ variantId: sageM().id, quantity: 1 }]);
      await placeOrder([{ variantId: sageM().id, quantity: 2 }]); // stays pending
      const { paymentId } = await (await app.request('/api/payments/checkout', post({ orderId: paidOrder.id, email: 'guest@example.com' }))).json();
      await app.request('/api/payments/confirm', post({ paymentId, outcome: 'success', email: 'guest@example.com' }));

      const res = await app.request('/api/admin/summary', bearer(adminToken));
      expect(res.status).toBe(200);
      const summary = await res.json();
      expect(summary.activeOrders).toBe(1);
      expect(summary.pendingPayments).toBe(1);
      expect(summary.revenue).toBe(paidOrder.total);
      // One row per fully-out piece: sage's only sized variant (M) hit 0 after
      // the two orders above; moss still has an S in stock; inactive pieces
      // and Custom-only sizing never count.
      expect(summary.lowStock).toContainEqual(
        expect.objectContaining({
          productId: seeded.sage.id,
          productName: 'Sage Sequin Jacket Lehenga',
          color: 'Sage',
        }),
      );
      expect(summary.lowStock.map((r: any) => r.productId)).not.toContain(seeded.moss.id);
      expect(summary.lowStock.map((r: any) => r.productId)).not.toContain(seeded.inactive.id);
      expect(summary.recentOrders).toHaveLength(2);
      expect(summary.recentOrders[0]).toMatchObject({
        orderNumber: expect.stringMatching(/^TA-2026-\d{5}$/),
        itemsCount: 2,
        status: 'pending_payment',
        firstName: 'Guest',
      });
      expect(summary.recentOrders[0]).toHaveProperty('id');
      expect(summary.recentOrders[0]).toHaveProperty('createdAt');
      expect(summary.recentOrders[0]).toHaveProperty('total');
    });
  });

  describe('admin offline orders', () => {
    const offlineBody = (over: Record<string, unknown> = {}) => ({
      channel: 'in_store',
      billType: 'gst_invoice',
      billNumber: 'GST-001',
      customer: { action: 'create', firstName: 'Rhea', phone: '98200 11223' },
      items: [{ description: 'Custom lehenga, bridal fit', quantity: 1, unitPrice: 12000000 }],
      total: 12000000,
      ...over,
    });

    async function createOffline(over: Record<string, unknown> = {}) {
      const res = await app.request('/api/admin/orders', post(offlineBody(over), adminToken));
      expect(res.status).toBe(201);
      return res.json() as Promise<any>;
    }

    it('the ledger lists manual receipts, not just gateway payments', async () => {
      const order = await createOffline({ advance: { amount: 2000000, mode: 'cash' } });
      const res = await app.request('/api/admin/payments', bearer(adminToken));
      expect(res.status).toBe(200);
      const entries = await res.json();
      expect(entries).toContainEqual(
        expect.objectContaining({
          source: 'manual',
          status: 'received',
          mode: 'cash',
          amount: 2000000,
          orderNumber: order.orderNumber,
        }),
      );
    });

    it('refuses a GST invoice without a bill number', async () => {
      const res = await app.request('/api/admin/orders', post(offlineBody({ billNumber: undefined }), adminToken));
      expect(res.status).toBe(400);
      const { error } = await res.json();
      expect(error).toMatch(/bill number/i);
    });

    it('refuses to clear the bill number of a GST invoice via PATCH', async () => {
      const order = await createOffline();
      const res = await app.request(
        `/api/admin/orders/${order.id}`,
        withMethod('PATCH', { billNumber: null }, adminToken),
      );
      expect(res.status).toBe(400);
      const { error } = await res.json();
      expect(error).toMatch(/bill number/i);
    });

    it('accepts quality_check and dispatched as initial statuses', async () => {
      const qc = await createOffline({ initialStatus: 'quality_check' });
      expect(qc.status).toBe('quality_check');
      const shipped = await createOffline({
        initialStatus: 'dispatched',
        customer: { action: 'create', firstName: 'Nur', phone: '98200 55667' },
      });
      expect(shipped.status).toBe('dispatched');
    });

    it('humanizes validation errors instead of leaking schema paths', async () => {
      const res = await app.request(
        '/api/admin/orders',
        post(
          offlineBody({
            customer: { action: 'create', firstName: 'Rhea', phone: '98200 11223', email: 'not-an-email' },
          }),
          adminToken,
        ),
      );
      expect(res.status).toBe(400);
      const { error } = await res.json();
      expect(error).toBe('Enter a valid email address, or leave it blank');
    });

    it('POST creates an offline order with a new customer and an advance receipt', async () => {
      const order = await createOffline({
        advance: { amount: 2000000, mode: 'cash' },
        deliveryDueDate: '2026-08-20',
        notes: 'Walk-in',
      });
      expect(order).toMatchObject({
        channel: 'in_store',
        billType: 'gst_invoice',
        billNumber: 'GST-001',
        status: 'in_atelier',
        phone: '+919820011223',
        email: '',
        total: 12000000,
        advancePaid: 2000000,
        balance: 10000000,
        deliveryDueDate: '2026-08-20',
        notes: 'Walk-in',
      });
      expect(order.items[0]).toMatchObject({ productId: null, variantId: null, productName: 'Custom lehenga, bridal fit' });
      expect(order.receipts).toHaveLength(1);
      expect(f.users.users.find((u) => u.phone === '+919820011223')).toMatchObject({ authProvider: 'otp' });
    });

    it('POST links an existing customer by id', async () => {
      const { user } = await registerCustomer();
      const order = await createOffline({ customer: { action: 'link', userId: user.id } });
      expect(order).toMatchObject({ userId: user.id, email: 'aanya@example.com', firstName: 'Aanya' });
    });

    it('POST rejects invalid bodies with 400 and domain errors with their statuses', async () => {
      for (const bad of [
        offlineBody({ channel: 'online' }),
        offlineBody({ billType: 'receipt' }),
        offlineBody({ items: [] }),
        offlineBody({ customer: { action: 'create', firstName: 'X' } }), // phone missing
        offlineBody({ customer: { action: 'link' } }), // userId missing
        offlineBody({ total: 12.5 }),
        offlineBody({ deliveryDueDate: '20-08-2026' }),
      ]) {
        const res = await app.request('/api/admin/orders', post(bad, adminToken));
        expect(res.status).toBe(400);
        expect(typeof (await res.json()).error).toBe('string');
      }
      const badPhone = await app.request(
        '/api/admin/orders',
        post(offlineBody({ customer: { action: 'create', firstName: 'X', phone: '12345' } }), adminToken),
      );
      expect(badPhone.status).toBe(400);
      const ghost = await app.request(
        '/api/admin/orders',
        post(offlineBody({ customer: { action: 'link', userId: 'ghost' } }), adminToken),
      );
      expect(ghost.status).toBe(404);
      const over = await app.request(
        '/api/admin/orders',
        post(offlineBody({ advance: { amount: 12000001, mode: 'cash' } }), adminToken),
      );
      expect(over.status).toBe(409);
    });

    it('POST requires admin: 401 anonymous, 403 customer', async () => {
      const { token: customerToken } = await registerCustomer();
      expect((await app.request('/api/admin/orders', post(offlineBody()))).status).toBe(401);
      expect((await app.request('/api/admin/orders', post(offlineBody(), customerToken))).status).toBe(403);
      expect((await app.request('/api/admin/customers/match?phone=9820011223')).status).toBe(401);
      expect((await app.request('/api/admin/customers/match?phone=9820011223', bearer(customerToken))).status).toBe(403);
    });

    it('POST /orders/:id/receipts records payments and refuses over-collection', async () => {
      const order = await createOffline({ advance: { amount: 2000000, mode: 'cash' } });
      const res = await app.request(
        `/api/admin/orders/${order.id}/receipts`,
        post({ amount: 10000000, mode: 'online', receivedAt: '2026-08-01', note: 'Final' }, adminToken),
      );
      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.advancePaid).toBe(12000000);
      expect(updated.balance).toBe(0);
      expect(updated.receipts).toHaveLength(2);

      const over = await app.request(
        `/api/admin/orders/${order.id}/receipts`,
        post({ amount: 1, mode: 'cash' }, adminToken),
      );
      expect(over.status).toBe(409);
      expect((await over.json()).error).toMatch(/exceed/i);

      expect(
        (await app.request(`/api/admin/orders/${order.id}/receipts`, post({ amount: 0, mode: 'cash' }, adminToken)))
          .status,
      ).toBe(400);
      expect(
        (await app.request('/api/admin/orders/ghost/receipts', post({ amount: 1, mode: 'cash' }, adminToken))).status,
      ).toBe(404);
    });

    it('PATCH /orders/:id patches details when no status is given, still walks the machine with one', async () => {
      const order = await createOffline();
      const details = await app.request(
        `/api/admin/orders/${order.id}`,
        withMethod('PATCH', { deliveryDueDate: '2026-09-01', notes: 'Client travelling' }, adminToken),
      );
      expect(details.status).toBe(200);
      expect(await details.json()).toMatchObject({
        deliveryDueDate: '2026-09-01',
        notes: 'Client travelling',
        status: 'in_atelier',
      });

      const moved = await app.request(
        `/api/admin/orders/${order.id}`,
        withMethod('PATCH', { status: 'quality_check' }, adminToken),
      );
      expect(moved.status).toBe(200);
      expect((await moved.json()).status).toBe('quality_check');

      // offline cancel from quality_check is allowed and does not restock
      const cancelled = await app.request(
        `/api/admin/orders/${order.id}`,
        withMethod('PATCH', { status: 'cancelled' }, adminToken),
      );
      expect((await cancelled.json()).status).toBe('cancelled');

      expect(
        (await app.request('/api/admin/orders/ghost', withMethod('PATCH', { notes: 'x' }, adminToken))).status,
      ).toBe(404);
    });

    it('GET /orders filters by channel and billType alongside status', async () => {
      await createOffline(); // in_store, gst_invoice
      await createOffline({
        channel: 'exhibition',
        billType: 'cash_memo',
        billNumber: 'CM-9',
        customer: { action: 'create', firstName: 'Zoya', phone: '98200 33445' },
        initialStatus: 'delivered',
      });
      await placeOrder([{ variantId: sageM().id, quantity: 1 }]); // online

      const byChannel = await (await app.request('/api/admin/orders?channel=in_store', bearer(adminToken))).json();
      expect(byChannel).toHaveLength(1);
      expect(byChannel[0].channel).toBe('in_store');

      const online = await (await app.request('/api/admin/orders?channel=online', bearer(adminToken))).json();
      expect(online).toHaveLength(1);

      const byBill = await (await app.request('/api/admin/orders?billType=cash_memo', bearer(adminToken))).json();
      expect(byBill).toHaveLength(1);
      expect(byBill[0].billNumber).toBe('CM-9');

      const combined = await (
        await app.request('/api/admin/orders?status=delivered&channel=exhibition', bearer(adminToken))
      ).json();
      expect(combined).toHaveLength(1);

      expect((await app.request('/api/admin/orders?channel=fax', bearer(adminToken))).status).toBe(400);
    });

    it('GET /customers/match ranks the exact phone first, then email/name matches', async () => {
      await registerCustomer(); // aanya@example.com
      await createOffline(); // creates Rhea +919820011223 with one order

      const byPhone = await (
        await app.request('/api/admin/customers/match?phone=98200 11223', bearer(adminToken))
      ).json();
      expect(byPhone.candidates[0]).toMatchObject({ phone: '+919820011223', firstName: 'Rhea', ordersCount: 1 });

      const byName = await (await app.request('/api/admin/customers/match?q=aanya', bearer(adminToken))).json();
      expect(byName.candidates).toHaveLength(1);
      expect(byName.candidates[0]).toMatchObject({ email: 'aanya@example.com', ordersCount: 0 });

      const both = await (
        await app.request('/api/admin/customers/match?phone=9820011223&q=aanya', bearer(adminToken))
      ).json();
      expect(both.candidates.map((c: any) => c.firstName)).toEqual(['Rhea', 'Aanya']);

      const none = await (await app.request('/api/admin/customers/match', bearer(adminToken))).json();
      expect(none).toEqual({ candidates: [] });
    });

    it('summary reports revenueByChannel, revenueByBillType and pendingToCollect', async () => {
      const paidOrder = await placeOrder([{ variantId: sageM().id, quantity: 1 }]);
      const { paymentId } = await (
        await app.request('/api/payments/checkout', post({ orderId: paidOrder.id, email: 'guest@example.com' }))
      ).json();
      await app.request('/api/payments/confirm', post({ paymentId, outcome: 'success', email: 'guest@example.com' }));
      await createOffline({ advance: { amount: 2000000, mode: 'cash' } }); // in_atelier, owes 1,00,00,000
      await createOffline({
        channel: 'exhibition',
        billType: 'cash_memo',
        customer: { action: 'create', firstName: 'Zoya', phone: '98200 33445' },
        total: 5000000,
        items: [{ description: 'Stole', quantity: 1, unitPrice: 5000000 }],
        advance: { amount: 5000000, mode: 'online' },
        initialStatus: 'delivered', // fully collected — not pending
      });

      const summary = await (await app.request('/api/admin/summary', bearer(adminToken))).json();
      // Money actually received: the online capture, the ₹20,000 advance, and
      // the exhibition sale's full payment — NOT the in_atelier order's billed
      // total (₹1,00,000 of it is still owed).
      expect(summary.revenue).toBe(paidOrder.total + 2000000 + 5000000);
      expect(summary.revenueByChannel).toEqual({
        online: paidOrder.total,
        in_store: 12000000,
        exhibition: 5000000,
      });
      expect(summary.revenueByBillType).toEqual({ gst_invoice: 12000000, cash_memo: 5000000 });
      expect(summary.pendingToCollect).toBe(10000000);
      // existing fields keep working
      expect(summary.activeOrders).toBe(2); // paid online + in_atelier offline
      expect(summary.recentOrders.length).toBeGreaterThan(0);
    });
  });

  describe('socials', () => {
    it('POST /api/socials/scan records a scan and returns empty 204', async () => {
      const res = await app.request('/api/socials/scan', post({ source: 'Instagram Bio' }));
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      expect(f.scans.scans).toHaveLength(1);
      expect(f.scans.scans[0].source).toBe('instagram-bio');
    });

    it('records the request User-Agent and Referer, truncated', async () => {
      const res = await app.request('/api/socials/scan', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'x'.repeat(600),
          Referer: 'https://instagram.com/tanviagnihotry',
        },
        body: JSON.stringify({ source: 'packaging-qr' }),
      });
      expect(res.status).toBe(204);
      expect(f.scans.scans[0].userAgent).toHaveLength(512);
      expect(f.scans.scans[0].referer).toBe('https://instagram.com/tanviagnihotry');
    });

    it('400 {error:{code:"INVALID_SOURCE"}} for a charset-invalid source', async () => {
      const res = await app.request('/api/socials/scan', post({ source: 'café!' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: 'INVALID_SOURCE', message: expect.any(String) } });
      expect(f.scans.scans).toHaveLength(0);
    });

    it('400 {error:string} on a missing/empty source (zod)', async () => {
      const empty = await app.request('/api/socials/scan', post({ source: '' }));
      expect(empty.status).toBe(400);
      expect(typeof (await empty.json()).error).toBe('string');
      const missing = await app.request('/api/socials/scan', post({}));
      expect(missing.status).toBe(400);
    });

    it('GET /api/socials/stats requires admin auth: 401 anonymous, 403 customer', async () => {
      expect((await app.request('/api/socials/stats')).status).toBe(401);
      const { token: customerToken } = await registerCustomer();
      expect((await app.request('/api/socials/stats', bearer(customerToken))).status).toBe(403);
    });

    it('GET /api/socials/stats returns aggregated stats ordered by total desc', async () => {
      await app.request('/api/socials/scan', post({ source: 'instagram-bio' }));
      await app.request('/api/socials/scan', post({ source: 'instagram-bio' }));
      await app.request('/api/socials/scan', post({ source: 'packaging-qr' }));

      const res = await app.request('/api/socials/stats', bearer(adminToken));
      expect(res.status).toBe(200);
      const { stats } = await res.json();
      expect(stats[0]).toMatchObject({ source: 'instagram-bio', total: 2, last7: 2, last30: 2 });
      expect(stats[1]).toMatchObject({ source: 'packaging-qr', total: 1 });
      expect(stats[0]).toHaveProperty('lastScanAt');
    });

    it('POST /api/socials/click records a click with source attribution and returns 204', async () => {
      const res = await app.request('/api/socials/click', post({ link: 'WhatsApp', source: 'Store-Window' }));
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      expect(f.clicks.clicks).toHaveLength(1);
      expect(f.clicks.clicks[0]).toMatchObject({ link: 'whatsapp', source: 'store-window' });
    });

    it('POST /api/socials/click keeps the click with null source when source is absent or invalid', async () => {
      expect((await app.request('/api/socials/click', post({ link: 'instagram' }))).status).toBe(204);
      expect((await app.request('/api/socials/click', post({ link: 'instagram', source: 'café!' }))).status).toBe(204);
      expect(f.clicks.clicks).toHaveLength(2);
      expect(f.clicks.clicks[0].source).toBeNull();
      expect(f.clicks.clicks[1].source).toBeNull();
    });

    it('400 {error:{code:"INVALID_LINK"}} for a charset-invalid link', async () => {
      const res = await app.request('/api/socials/click', post({ link: 'café!' }));
      expect(res.status).toBe(400);
      expect(await res.json()).toEqual({ error: { code: 'INVALID_LINK', message: expect.any(String) } });
      expect(f.clicks.clicks).toHaveLength(0);
    });

    it('GET /api/socials/stats also returns clicks grouped by link and source', async () => {
      await app.request('/api/socials/click', post({ link: 'whatsapp', source: 'store-window' }));
      await app.request('/api/socials/click', post({ link: 'whatsapp', source: 'store-window' }));
      await app.request('/api/socials/click', post({ link: 'instagram' }));

      const res = await app.request('/api/socials/stats', bearer(adminToken));
      expect(res.status).toBe(200);
      const { clicks } = await res.json();
      expect(clicks[0]).toMatchObject({ link: 'whatsapp', source: 'store-window', total: 2, last7: 2, last30: 2 });
      expect(clicks).toContainEqual(expect.objectContaining({ link: 'instagram', source: null, total: 1 }));
      expect(clicks[0]).toHaveProperty('lastClickAt');
    });
  });

  describe('analytics', () => {
    const VISITOR = '11111111-1111-1111-1111-111111111111';
    const SESSION = '22222222-2222-2222-2222-222222222222';
    const validBatch = () => ({
      visitorId: VISITOR,
      sessionId: SESSION,
      events: [{ type: 'page_view', path: '/shop' }],
    });

    it('POST /api/track records a valid batch and returns empty 204', async () => {
      const res = await app.request('/api/track', post(validBatch()));
      expect(res.status).toBe(204);
      expect(await res.text()).toBe('');
      expect(f.events.rows).toHaveLength(1);
      expect(f.events.rows[0]).toMatchObject({
        eventType: 'page_view',
        visitorId: VISITOR,
        sessionId: SESSION,
        path: '/shop',
        userId: null,
        productId: null,
        device: 'desktop',
        props: {},
      });
    });

    it('maps userId, productId and props through to the repo', async () => {
      const res = await app.request(
        '/api/track',
        post({
          visitorId: VISITOR,
          sessionId: SESSION,
          userId: '33333333-3333-3333-3333-333333333333',
          events: [
            { type: 'product_view', productId: '44444444-4444-4444-4444-444444444444', props: { color: 'sage' } },
          ],
        }),
      );
      expect(res.status).toBe(204);
      expect(f.events.rows[0]).toMatchObject({
        eventType: 'product_view',
        userId: '33333333-3333-3333-3333-333333333333',
        productId: '44444444-4444-4444-4444-444444444444',
        props: { color: 'sage' },
      });
    });

    it('400 {error:string} on an unknown event type', async () => {
      const res = await app.request('/api/track', post({ ...validBatch(), events: [{ type: 'made_up_event' }] }));
      expect(res.status).toBe(400);
      expect(typeof (await res.json()).error).toBe('string');
      expect(f.events.rows).toHaveLength(0);
    });

    it('accepts a batch of exactly 20 events but rejects 21 with 400', async () => {
      const twenty = Array.from({ length: 20 }, () => ({ type: 'page_view' }));
      const ok = await app.request('/api/track', post({ ...validBatch(), events: twenty }));
      expect(ok.status).toBe(204);
      expect(f.events.rows).toHaveLength(20);

      const twentyOne = Array.from({ length: 21 }, () => ({ type: 'page_view' }));
      const tooMany = await app.request('/api/track', post({ ...validBatch(), events: twentyOne }));
      expect(tooMany.status).toBe(400);
      expect(f.events.rows).toHaveLength(20); // unchanged — the rejected batch inserted nothing
    });

    it('400 on an empty events array', async () => {
      const res = await app.request('/api/track', post({ ...validBatch(), events: [] }));
      expect(res.status).toBe(400);
      expect(f.events.rows).toHaveLength(0);
    });

    it('400 on a non-uuid visitorId', async () => {
      const res = await app.request('/api/track', post({ ...validBatch(), visitorId: 'not-a-uuid' }));
      expect(res.status).toBe(400);
      expect(f.events.rows).toHaveLength(0);
    });
  });

  describe('analytics summary (admin read)', () => {
    it('GET /api/analytics/summary requires admin auth: 401 anonymous, 403 customer', async () => {
      expect((await app.request('/api/analytics/summary')).status).toBe(401);
      const { token: customerToken } = await registerCustomer();
      expect((await app.request('/api/analytics/summary', bearer(customerToken))).status).toBe(403);
    });

    it('?days=14 is rejected with 400; 7/30(default)/90 are accepted', async () => {
      expect((await app.request('/api/analytics/summary?days=14', bearer(adminToken))).status).toBe(400);
      expect((await app.request('/api/analytics/summary?days=7', bearer(adminToken))).status).toBe(200);
      expect((await app.request('/api/analytics/summary?days=90', bearer(adminToken))).status).toBe(200);
      expect((await app.request('/api/analytics/summary', bearer(adminToken))).status).toBe(200); // default 30
    });

    it('returns the full response contract shape with seeded events', async () => {
      const V1 = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
      const V2 = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';
      // Fake product ids (e.g. 'p-1') aren't valid UUIDs, and the /track schema requires
      // productId to be a UUID — use a standalone UUID and seed its display name directly.
      const PRODUCT_ID = 'cccccccc-cccc-cccc-cccc-cccccccccccc';
      const PRODUCT_NAME = 'Sage Sequin Jacket Lehenga';
      f.events.productNames.set(PRODUCT_ID, PRODUCT_NAME);

      // Session 1: lands via a UTM source, views + carts the product, searches (zero results), then buys.
      await app.request('/api/track', post({
        visitorId: V1,
        sessionId: '11111111-aaaa-aaaa-aaaa-111111111111',
        events: [
          { type: 'session_start', props: { utmSource: 'newsletter' } },
          { type: 'product_view', productId: PRODUCT_ID },
          { type: 'add_to_cart', productId: PRODUCT_ID, props: { size: 'M', color: 'Sage' } },
          { type: 'search', props: { query: 'lehenga', results: 0 } },
          { type: 'checkout_start' },
          { type: 'order_placed', props: { total: 18400000, items: [{ productId: PRODUCT_ID, qty: 1 }] } },
        ],
      }));

      // Session 2: direct visit, just browses (no conversion) — mobile device.
      await app.request('/api/track', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Mobile/15E148',
        },
        body: JSON.stringify({
          visitorId: V2,
          sessionId: '22222222-bbbb-bbbb-bbbb-222222222222',
          events: [
            { type: 'session_start', props: {} },
            { type: 'search', props: { query: 'gown', results: 4 } },
          ],
        }),
      });

      const res = await app.request('/api/analytics/summary', bearer(adminToken));
      expect(res.status).toBe(200);
      const body = await res.json();

      expect(body.kpis).toMatchObject({
        sessions: 2,
        orders: 1,
        revenue: 18400000,
      });
      expect(body.kpis.conversionRate).toBeCloseTo(0.5);
      expect(typeof body.kpis.aov).toBe('number');
      expect(Number.isNaN(body.kpis.aov)).toBe(false);

      expect(body.funnel.map((stage: any) => stage.stage)).toEqual([
        'Sessions',
        'Product views',
        'Added to cart',
        'Checkout',
        'Purchased',
      ]);
      expect(body.funnel.every((stage: any) => typeof stage.sessions === 'number')).toBe(true);

      expect(Array.isArray(body.trend)).toBe(true);
      expect(body.trend.length).toBe(30); // default days window, gap-filled
      expect(body.trend[0]).toMatchObject({ orders: expect.any(Number), sessions: expect.any(Number) });
      expect(body.trend[0].day).toMatch(/^\d{4}-\d{2}-\d{2}$/);

      expect(body.topProducts).toContainEqual(
        expect.objectContaining({ productId: PRODUCT_ID, name: PRODUCT_NAME, views: 1, carts: 1, purchased: 1 }),
      );

      expect(body.topSearches).toEqual(expect.arrayContaining([
        expect.objectContaining({ query: 'lehenga', searches: 1 }),
        expect.objectContaining({ query: 'gown', searches: 1 }),
      ]));
      expect(body.zeroSearches).toEqual([expect.objectContaining({ query: 'lehenga', searches: 1 })]);

      expect(body.sources).toContainEqual({ source: 'newsletter', sessions: 1 });
      expect(body.sources).toContainEqual({ source: 'direct', sessions: 1 });

      expect(body.devices).toEqual(expect.arrayContaining([
        expect.objectContaining({ device: 'desktop', sessions: 1 }),
        expect.objectContaining({ device: 'mobile', sessions: 1 }),
      ]));

      expect(body.sizes).toContainEqual({ size: 'M', adds: 1 });
      expect(body.colors).toContainEqual({ color: 'Sage', adds: 1 });
    });
  });
});
