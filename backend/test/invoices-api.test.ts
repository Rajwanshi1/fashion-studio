import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { FakeObjectStore, FakePaymentProvider, FakeWhatsAppProvider, Fakes, fakeTx, makeFakes } from './fakes';

const SECRET = 'invoices-api-test-secret';

const post = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const send = (token?: string) => ({
  method: 'POST',
  headers: token ? { Authorization: `Bearer ${token}` } : {},
});
const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

const OFFLINE_ORDER = {
  channel: 'in_store',
  billType: 'cash_memo',
  billNumber: '02',
  customer: { action: 'create', firstName: 'Rhea', phone: '98200 11223' },
  items: [{ description: 'Sage lehenga', quantity: 1, unitPrice: 4500000 }],
  total: 4500000,
};

describe('invoice admin API', () => {
  let f: Fakes;
  let whatsapp: FakeWhatsAppProvider;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let customerToken: string;

  function makeApp(withWhatsApp: boolean) {
    return createApp({
      repos: f,
      paymentProvider: new FakePaymentProvider(),
      objectStore: new FakeObjectStore(),
      whatsappProvider: withWhatsApp ? whatsapp : null,
      jwtSecret: SECRET,
      corsOrigins: ['http://localhost:5173'],
      runInTransaction: fakeTx,
    });
  }

  beforeEach(async () => {
    f = makeFakes();
    whatsapp = new FakeWhatsAppProvider();
    await f.users.create({
      email: 'admin@tanviagnihotry.com',
      passwordHash: await bcrypt.hash('TanviAdmin@2026', 4),
      firstName: 'Tanvi',
      lastName: 'Agnihotry',
      role: 'admin',
    });
    app = makeApp(true);
    const login = await app.request('/api/auth/login', post({ email: 'admin@tanviagnihotry.com', password: 'TanviAdmin@2026' }));
    adminToken = (await login.json()).token;
    const reg = await app.request('/api/auth/register', post({ email: 'cust@example.com', password: 'Cust@2026x', firstName: 'C' }));
    customerToken = (await reg.json()).token;
  });

  async function recordOrder(): Promise<{ id: string; orderNumber: string }> {
    const res = await app.request('/api/admin/orders', post(OFFLINE_ORDER, adminToken));
    expect(res.status).toBe(201);
    return res.json();
  }

  describe('GET /api/admin/orders/:id/invoice.pdf', () => {
    it('renders the invoice as a fresh PDF', async () => {
      const order = await recordOrder();
      const res = await app.request(`/api/admin/orders/${order.id}/invoice.pdf`, bearer(adminToken));
      expect(res.status).toBe(200);
      expect(res.headers.get('Content-Type')).toContain('application/pdf');
      expect(res.headers.get('Content-Disposition')).toBe(`inline; filename="${order.orderNumber}.pdf"`);
      const bytes = Buffer.from(await res.arrayBuffer());
      expect(bytes.subarray(0, 5).toString()).toBe('%PDF-');
    });

    it('404s for an unknown order', async () => {
      const res = await app.request('/api/admin/orders/ghost/invoice.pdf', bearer(adminToken));
      expect(res.status).toBe(404);
    });

    it('403s for a non-admin', async () => {
      const order = await recordOrder();
      const res = await app.request(`/api/admin/orders/${order.id}/invoice.pdf`, bearer(customerToken));
      expect(res.status).toBe(403);
    });
  });

  describe('POST /api/admin/orders/:id/invoice/send', () => {
    it('sends the PDF via the provider and stamps invoiceSentAt', async () => {
      const order = await recordOrder();
      const res = await app.request(`/api/admin/orders/${order.id}/invoice/send`, send(adminToken));
      expect(res.status).toBe(200);
      const updated = await res.json();
      expect(updated.invoiceSentAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
      expect(whatsapp.sent).toEqual([
        {
          phone: '+919820011223',
          filename: `${order.orderNumber}.pdf`,
          vars: { customerName: 'Rhea', orderNumber: order.orderNumber, total: '₹45,000' },
          bytes: expect.any(Number),
        },
      ]);
      expect(whatsapp.sent[0].bytes).toBeGreaterThan(10_000);
    });

    it('503s while no provider is configured (nothing stamped)', async () => {
      const order = await recordOrder();
      const masked = makeApp(false);
      const res = await masked.request(`/api/admin/orders/${order.id}/invoice/send`, send(adminToken));
      expect(res.status).toBe(503);
      expect((await f.orders.getById(order.id))?.invoiceSentAt).toBeNull();
    });

    it('400s when the customer has no phone on file', async () => {
      const phoneless = await f.orders.createOffline(
        {},
        {
          orderNumber: 'TA-2026-09999',
          userId: null,
          email: 'walkin@example.com',
          phone: '',
          firstName: 'Walk-in',
          lastName: '',
          addressLine1: '',
          addressLine2: '',
          city: '',
          state: '',
          pincode: '',
          country: 'India',
          deliveryMethod: 'standard',
          deliveryFee: 0,
          subtotal: 100000,
          total: 100000,
          status: 'delivered',
          channel: 'in_store',
          billType: 'cash_memo',
          billNumber: null,
          gstAmount: null,
          deliveryDueDate: null,
          notes: '',
        },
        [{ productName: 'Dupatta', unitPrice: 100000, quantity: 1 }],
      );
      const res = await app.request(`/api/admin/orders/${phoneless.id}/invoice/send`, send(adminToken));
      expect(res.status).toBe(400);
      expect(whatsapp.sent).toHaveLength(0);
    });

    it('502s when the provider fails, leaving invoiceSentAt unset', async () => {
      const order = await recordOrder();
      whatsapp.failWith = new Error('WhatsApp media upload failed: Invalid OAuth access token');
      const res = await app.request(`/api/admin/orders/${order.id}/invoice/send`, send(adminToken));
      expect(res.status).toBe(502);
      expect((await res.json()).error).toMatch(/Invalid OAuth access token/);
      expect((await f.orders.getById(order.id))?.invoiceSentAt).toBeNull();
    });

    it('404s for an unknown order', async () => {
      const res = await app.request('/api/admin/orders/ghost/invoice/send', send(adminToken));
      expect(res.status).toBe(404);
    });
  });
});
