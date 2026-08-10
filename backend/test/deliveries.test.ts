import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { deliveryTotals } from '../src/lib/deliveries';
import { customersToVcf } from '../src/lib/vcard';
import type { Order, Receipt } from '../src/types';
import { seedCatalog, FakeObjectStore, FakePaymentProvider, Fakes, fakeTx, makeFakes } from './fakes';

const SECRET = 'deliveries-test-secret';

const post = (body: unknown, token?: string) => ({
  method: 'POST',
  headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
  body: JSON.stringify(body),
});
const bearer = (token: string) => ({ headers: { Authorization: `Bearer ${token}` } });

describe('customersToVcf', () => {
  it('renders vCard 3.0 cards with CRLF endings and the — TA suffix', () => {
    const vcf = customersToVcf([{ firstName: 'Meera', lastName: 'Shah', phone: '+919876543210' }]);
    expect(vcf).toContain('BEGIN:VCARD\r\nVERSION:3.0\r\n');
    expect(vcf).toContain('N:Shah;Meera;;;');
    expect(vcf).toContain('FN:Meera Shah — TA');
    expect(vcf).toContain('TEL;TYPE=CELL:+919876543210');
    expect(vcf.endsWith('END:VCARD\r\n')).toBe(true);
  });

  it('escapes commas, semicolons, backslashes and newlines', () => {
    const vcf = customersToVcf([{ firstName: 'A,B;C\\D', lastName: 'X\nY', phone: '+911111111111' }]);
    expect(vcf).toContain('N:X\\nY;A\\,B\\;C\\\\D;;;');
  });

  it('falls back to "TA Client <phone>" for nameless accounts and handles empty input', () => {
    const vcf = customersToVcf([{ firstName: '', lastName: '', phone: '+919000000001' }]);
    expect(vcf).toContain('FN:TA Client +919000000001');
    expect(customersToVcf([])).toBe('');
  });
});

describe('deliveryTotals', () => {
  const order = (balance: number, receipts: Pick<Receipt, 'amount' | 'mode'>[]): Order =>
    ({ balance, receipts }) as Order;

  it('sums outstanding balances and splits receipts by mode', () => {
    const totals = deliveryTotals([
      order(2500000, [{ amount: 2000000, mode: 'cash' }]),
      order(0, [{ amount: 1000000, mode: 'online' }, { amount: 500000, mode: 'cash' }]),
      order(-100, []), // over-collection safety: never negative
    ]);
    expect(totals).toEqual({ pendingToCollect: 2500000, collectedCash: 2500000, collectedOnline: 1000000 });
  });
});

describe('delivery board & contacts export API', () => {
  let f: Fakes;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let customerToken: string;

  async function createOffline(due: string | undefined, advance?: { amount: number; mode: 'cash' | 'online' }) {
    const res = await app.request(
      '/api/admin/orders',
      post(
        {
          channel: 'in_store',
          billType: 'cash_memo',
          customer: { action: 'create', firstName: 'Meera', lastName: 'Shah', phone: `98${String(Math.floor(Math.random() * 1e8)).padStart(8, '0')}` },
          items: [{ description: 'Lehenga', quantity: 1, unitPrice: 4500000 }],
          total: 4500000,
          ...(advance ? { advance } : {}),
          ...(due ? { deliveryDueDate: due } : {}),
        },
        adminToken,
      ),
    );
    expect(res.status).toBe(201);
    return res.json() as Promise<Order>;
  }

  beforeEach(async () => {
    f = makeFakes();
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
    const reg = await app.request('/api/auth/register', post({ email: 'cust@example.com', password: 'Cust@2026x', firstName: 'C' }));
    customerToken = (await reg.json()).token;
  });

  describe('GET /api/admin/deliveries', () => {
    it('403 for a non-admin', async () => {
      expect((await app.request('/api/admin/deliveries', bearer(customerToken))).status).toBe(403);
    });

    it('returns dated open orders soonest-first with money totals', async () => {
      const later = await createOffline('2026-08-20', { amount: 1000000, mode: 'online' });
      const soon = await createOffline('2026-08-01', { amount: 2000000, mode: 'cash' });
      await createOffline(undefined); // no due date → excluded
      const delivered = await createOffline('2026-08-05');
      // walk the offline machine to delivered → excluded
      for (const status of ['quality_check', 'dispatched', 'delivered']) {
        await app.request(`/api/admin/orders/${delivered.id}`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${adminToken}` },
          body: JSON.stringify({ status }),
        });
      }

      const res = await app.request('/api/admin/deliveries', bearer(adminToken));
      expect(res.status).toBe(200);
      const { orders, unscheduled, totals } = await res.json();
      expect(orders.map((o: Order) => o.id)).toEqual([soon.id, later.id]);
      // The date-less open order is not lost — it shows in its own bucket…
      expect(unscheduled.map((o: Order) => o.status)).toEqual(['in_atelier']);
      expect(totals).toEqual({
        // …and its balance counts: totals cover exactly the orders the board
        // shows, unscheduled included.
        pendingToCollect: (4500000 - 2000000) + (4500000 - 1000000) + 4500000,
        collectedCash: 2000000,
        collectedOnline: 1000000,
      });
    });

    it('unscheduled lists only offline work — abandoned online checkouts never appear', async () => {
      // A guest checkout that was never paid: online, pending_payment, no due date.
      const seeded = await seedCatalog(f.products);
      const guest = await app.request(
        '/api/orders',
        post({
          customer: {
            email: 'guest@example.com',
            firstName: 'Guest',
            lastName: '',
            addressLine1: '1 Lane',
            addressLine2: '',
            city: 'Mumbai',
            state: 'MH',
            pincode: '400001',
            country: 'India',
          },
          deliveryMethod: 'standard',
          items: [{ variantId: seeded.sage.variants[0].id, quantity: 1 }],
        }),
      );
      expect(guest.status).toBe(201);

      const offline = await createOffline(undefined);
      const { unscheduled } = await (await app.request('/api/admin/deliveries', bearer(adminToken))).json();
      expect(unscheduled.map((o: Order) => o.id)).toEqual([offline.id]);
    });
  });

  describe('GET /api/admin/customers.vcf', () => {
    it('exports only phone-having users as an attachment', async () => {
      await createOffline('2026-08-01'); // creates a phone customer "Meera Shah"
      const res = await app.request('/api/admin/customers.vcf', bearer(adminToken));
      expect(res.status).toBe(200);
      expect(res.headers.get('content-type')).toContain('text/vcard');
      expect(res.headers.get('content-disposition')).toContain('ta-customers.vcf');
      const body = await res.text();
      expect(body).toContain('FN:Meera Shah — TA');
      // admin + cust@example.com have no phone → no cards for them
      expect(body).not.toContain('Tanvi');
      expect(body).not.toContain('cust@example.com');
    });

    it('403 for a non-admin', async () => {
      expect((await app.request('/api/admin/customers.vcf', bearer(customerToken))).status).toBe(403);
    });
  });
});
