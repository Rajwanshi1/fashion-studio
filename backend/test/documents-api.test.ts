import bcrypt from 'bcryptjs';
import { beforeEach, describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import {
  FakeBillParser,
  FakeObjectStore,
  FakePaymentProvider,
  Fakes,
  fakeTx,
  makeFakes,
} from './fakes';

const SECRET = 'documents-api-test-secret';

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

const OFFLINE_ORDER = {
  channel: 'in_store',
  billType: 'cash_memo',
  customer: { action: 'create', firstName: 'Rhea', phone: '98200 11223' },
  items: [{ description: 'Sage lehenga', quantity: 1, unitPrice: 4500000 }],
  total: 4500000,
};

describe('documents & measurements admin API', () => {
  let f: Fakes;
  let store: FakeObjectStore;
  let parser: FakeBillParser;
  let app: ReturnType<typeof createApp>;
  let adminToken: string;
  let customerToken: string;

  function makeApp(withParser: boolean) {
    return createApp({
      repos: f,
      paymentProvider: new FakePaymentProvider(),
      objectStore: store,
      billParser: withParser ? parser : null,
      jwtSecret: SECRET,
      corsOrigins: ['http://localhost:5173'],
      runInTransaction: fakeTx,
    });
  }

  beforeEach(async () => {
    f = makeFakes();
    store = new FakeObjectStore();
    parser = new FakeBillParser();
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

  async function presign(kind = 'bill', contentType = 'image/jpeg') {
    const res = await app.request('/api/admin/uploads/presign', post({ kind, contentType }, adminToken));
    expect(res.status).toBe(201);
    return res.json() as Promise<{ documentId: string; uploadUrl: string; headers: Record<string, string> }>;
  }

  describe('POST /api/admin/uploads/presign', () => {
    it('403 for a non-admin', async () => {
      const res = await app.request('/api/admin/uploads/presign', post({ kind: 'bill', contentType: 'image/jpeg' }, customerToken));
      expect(res.status).toBe(403);
    });

    it('400 for a bad kind or content type', async () => {
      for (const body of [
        { kind: 'passport', contentType: 'image/jpeg' },
        { kind: 'bill', contentType: 'application/pdf' },
        { kind: 'bill' },
      ]) {
        const res = await app.request('/api/admin/uploads/presign', post(body, adminToken));
        expect(res.status).toBe(400);
        expect(typeof (await res.json()).error).toBe('string');
      }
    });

    it('creates an uploaded document and returns the presigned PUT', async () => {
      const result = await presign('measurement', 'image/png');
      expect(f.documents.docs).toHaveLength(1);
      const doc = f.documents.docs[0];
      expect(doc).toMatchObject({ id: result.documentId, kind: 'measurement', contentType: 'image/png', status: 'uploaded' });
      expect(doc.uploadedBy).toBe(f.users.users[0].id); // the admin
      expect(result.uploadUrl).toContain(encodeURIComponent(doc.storageKey));
      expect(result.headers).toEqual({ 'Content-Type': 'image/png' });
    });
  });

  describe('POST /api/admin/documents/:id/parse', () => {
    it('503 masked while no parser is configured (document untouched)', async () => {
      const { documentId } = await presign();
      const masked = makeApp(false);
      const res = await masked.request(`/api/admin/documents/${documentId}/parse`, withMethod('POST', undefined, adminToken));
      expect(res.status).toBe(503);
      expect((await res.json()).error).toMatch(/not configured/i);
      expect(f.documents.docs[0].status).toBe('uploaded');
    });

    it('parses the stored photo and returns the draft', async () => {
      const { documentId } = await presign('bill');
      store.put(f.documents.docs[0].storageKey, new Uint8Array([1, 2, 3]), 'image/jpeg');
      parser.draft = { totals: { total_rupees: 45000 }, confidence_notes: 'clear' };

      const res = await app.request(`/api/admin/documents/${documentId}/parse`, withMethod('POST', undefined, adminToken));
      expect(res.status).toBe(200);
      expect(await res.json()).toEqual(parser.draft);
      expect(parser.calls).toEqual([{ kind: 'bill', mediaType: 'image/jpeg', byteLength: 3 }]);
      expect(f.documents.docs[0].status).toBe('parsed');
    });

    it('404 for an unknown document', async () => {
      const res = await app.request('/api/admin/documents/00000000-0000-4000-8000-999999999999/parse', withMethod('POST', undefined, adminToken));
      expect(res.status).toBe(404);
    });
  });

  describe('GET /api/admin/documents/:id/url', () => {
    it('returns the presigned view URL', async () => {
      const { documentId } = await presign('shipping_receipt');
      const res = await app.request(`/api/admin/documents/${documentId}/url`, bearer(adminToken));
      expect(res.status).toBe(200);
      const { url } = await res.json();
      expect(url).toContain(encodeURIComponent(f.documents.docs[0].storageKey));
    });
  });

  describe('order documents: attach + list', () => {
    async function createOrder() {
      const res = await app.request('/api/admin/orders', post(OFFLINE_ORDER, adminToken));
      expect(res.status).toBe(201);
      return res.json() as Promise<{ id: string }>;
    }

    it('attaches a late shipping receipt as confirmed and lists it', async () => {
      const order = await createOrder();
      const { documentId } = await presign('shipping_receipt');

      const attach = await app.request(`/api/admin/orders/${order.id}/documents`, post({ documentId }, adminToken));
      expect(attach.status).toBe(201);
      expect(await attach.json()).toMatchObject({ id: documentId, kind: 'shipping_receipt', status: 'confirmed' });
      expect(f.documents.docs[0]).toMatchObject({ status: 'confirmed', orderId: order.id });

      const list = await app.request(`/api/admin/orders/${order.id}/documents`, bearer(adminToken));
      expect(list.status).toBe(200);
      const docs = await list.json();
      expect(docs).toEqual([
        { id: documentId, kind: 'shipping_receipt', status: 'confirmed', createdAt: f.documents.docs[0].createdAt },
      ]);
    });

    it('404s for an unknown order or document', async () => {
      const order = await createOrder();
      const { documentId } = await presign();
      expect(
        (await app.request('/api/admin/orders/nope/documents', post({ documentId }, adminToken))).status,
      ).toBe(404);
      expect(
        (await app.request(`/api/admin/orders/${order.id}/documents`, post({ documentId: 'ghost' }, adminToken))).status,
      ).toBe(404);
    });
  });

  describe('POST /api/admin/orders with documents + measurements', () => {
    it('confirms the documents and saves measurement sets against the new customer, all in the create', async () => {
      const bill = await presign('bill');
      const page = await presign('measurement');

      const res = await app.request(
        '/api/admin/orders',
        post(
          {
            ...OFFLINE_ORDER,
            documentIds: [bill.documentId, page.documentId],
            measurementSets: [
              {
                label: 'Blouse',
                data: { SH: '15 in', Bust: '38½' },
                notes: 'loose fit',
                documentId: page.documentId,
              },
            ],
          },
          adminToken,
        ),
      );
      expect(res.status).toBe(201);
      const order = await res.json();

      const customer = f.users.users.find((u) => u.phone === '+919820011223')!;
      expect(customer).toBeDefined();

      for (const id of [bill.documentId, page.documentId]) {
        expect(f.documents.docs.find((d) => d.id === id)).toMatchObject({ status: 'confirmed', orderId: order.id });
      }
      expect(f.measurements.measurements).toHaveLength(1);
      expect(f.measurements.measurements[0]).toMatchObject({
        userId: customer.id,
        orderId: order.id,
        documentId: page.documentId,
        label: 'Blouse',
        data: { SH: '15 in', Bust: '38½' },
        notes: 'loose fit',
      });
    });

    it('a failed create leaves no confirmed documents or measurements behind', async () => {
      const bill = await presign('bill');
      const res = await app.request(
        '/api/admin/orders',
        post(
          {
            ...OFFLINE_ORDER,
            customer: { action: 'link', userId: 'ghost' }, // NOT_FOUND after nothing else ran
            documentIds: [bill.documentId],
            measurementSets: [{ data: { SH: '15' } }],
          },
          adminToken,
        ),
      );
      expect(res.status).toBe(404);
      expect(f.documents.docs[0].status).toBe('uploaded');
      expect(f.measurements.measurements).toHaveLength(0);
    });
  });

  describe('GET /api/admin/measurements', () => {
    it('lists by userId and by orderId, 400 with neither', async () => {
      const page = await presign('measurement');
      const create = await app.request(
        '/api/admin/orders',
        post({ ...OFFLINE_ORDER, measurementSets: [{ label: 'Gown', data: { L: '52' }, documentId: page.documentId }] }, adminToken),
      );
      const order = await create.json();
      const customer = f.users.users.find((u) => u.phone === '+919820011223')!;

      const byUser = await app.request(`/api/admin/measurements?userId=${customer.id}`, bearer(adminToken));
      expect(byUser.status).toBe(200);
      expect(await byUser.json()).toEqual([
        expect.objectContaining({ userId: customer.id, orderId: order.id, label: 'Gown', data: { L: '52' } }),
      ]);

      const byOrder = await app.request(`/api/admin/measurements?orderId=${order.id}`, bearer(adminToken));
      expect(await byOrder.json()).toHaveLength(1);

      expect((await app.request('/api/admin/measurements', bearer(adminToken))).status).toBe(400);
    });
  });

  describe('PATCH /api/admin/orders/:id carrier/awb', () => {
    it('sets and clears carrier + AWB', async () => {
      const create = await app.request('/api/admin/orders', post(OFFLINE_ORDER, adminToken));
      const order = await create.json();

      const patched = await app.request(
        `/api/admin/orders/${order.id}`,
        withMethod('PATCH', { carrier: 'Blue Dart', awb: 'BD-778899' }, adminToken),
      );
      expect(patched.status).toBe(200);
      expect(await patched.json()).toMatchObject({ carrier: 'Blue Dart', awb: 'BD-778899' });

      const cleared = await app.request(
        `/api/admin/orders/${order.id}`,
        withMethod('PATCH', { carrier: null, awb: null }, adminToken),
      );
      expect(await cleared.json()).toMatchObject({ carrier: null, awb: null });
    });
  });
});
