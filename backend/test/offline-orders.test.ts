import { beforeEach, describe, expect, it } from 'vitest';
import {
  CreateOfflineOrderInput,
  OrdersService,
  createOrdersService,
} from '../src/services/orders.service';
import type { User } from '../src/types';
import { FakeOrdersRepo, FakeProductsRepo, FakeReceiptsRepo, FakeUsersRepo, fakeTx, seedCatalog } from './fakes';

describe('OrdersService — offline orders', () => {
  let products: FakeProductsRepo;
  let ordersRepo: FakeOrdersRepo;
  let usersRepo: FakeUsersRepo;
  let receiptsRepo: FakeReceiptsRepo;
  let service: OrdersService;
  let seeded: Awaited<ReturnType<typeof seedCatalog>>;
  let meera: User;

  const sageM = () => seeded.sage.variants[0]; // stock 3

  function input(over: Partial<CreateOfflineOrderInput> = {}): CreateOfflineOrderInput {
    return {
      channel: 'in_store',
      billType: 'gst_invoice',
      billNumber: 'GST-042',
      customer: { action: 'link', userId: meera.id },
      items: [{ description: 'Custom sage lehenga, bridal fit', quantity: 1, unitPrice: 15000000 }],
      total: 15000000,
      ...over,
    };
  }

  beforeEach(async () => {
    products = new FakeProductsRepo();
    seeded = await seedCatalog(products);
    ordersRepo = new FakeOrdersRepo();
    usersRepo = new FakeUsersRepo(ordersRepo);
    receiptsRepo = new FakeReceiptsRepo(ordersRepo);
    service = createOrdersService({
      products,
      orders: ordersRepo,
      users: usersRepo,
      receipts: receiptsRepo,
      runInTransaction: fakeTx,
    });
    meera = await usersRepo.create({
      email: 'meera@example.com',
      passwordHash: null,
      firstName: 'Meera',
      lastName: 'Kapoor',
      authProvider: 'otp',
      phone: '+919820000000',
    });
  });

  describe('createOfflineOrder', () => {
    it('links an existing customer and copies their identity onto the order', async () => {
      const order = await service.createOfflineOrder(input());
      expect(order).toMatchObject({
        userId: meera.id,
        email: 'meera@example.com',
        phone: '+919820000000',
        firstName: 'Meera',
        lastName: 'Kapoor',
        channel: 'in_store',
        billType: 'gst_invoice',
        billNumber: 'GST-042',
        status: 'in_atelier',
        deliveryMethod: 'standard',
        deliveryFee: 0,
        advancePaid: 0,
        balance: 15000000,
        receipts: [],
      });
      expect(order.orderNumber).toMatch(/^TA-2026-\d{5}$/);
      expect(order.items).toEqual([
        expect.objectContaining({
          productId: null,
          variantId: null,
          productName: 'Custom sage lehenga, bridal fit',
          size: '',
          color: '',
          unitPrice: 15000000,
          quantity: 1,
          imageUrl: null,
        }),
      ]);
    });

    it('throws NOT_FOUND when linking an unknown customer', async () => {
      await expect(
        service.createOfflineOrder(input({ customer: { action: 'link', userId: 'ghost' } })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(ordersRepo.orders).toHaveLength(0);
    });

    it('creates a phone-only customer (normalized, otp provider, unverified)', async () => {
      const order = await service.createOfflineOrder(
        input({
          customer: { action: 'create', firstName: 'Rhea', phone: '98200 11223', city: 'Pune' },
          channel: 'instagram',
          billType: 'cash_memo',
          billNumber: undefined,
        }),
      );
      const created = usersRepo.users.find((u) => u.phone === '+919820011223');
      expect(created).toMatchObject({
        firstName: 'Rhea',
        email: null,
        authProvider: 'otp',
        phoneVerified: false,
        passwordHash: null,
      });
      expect(order).toMatchObject({
        userId: created!.id,
        email: '',
        phone: '+919820011223',
        city: 'Pune',
        addressLine1: '',
        channel: 'instagram',
        billType: 'cash_memo',
        billNumber: null,
      });
    });

    it('lower-cases a provided email on both user and order', async () => {
      const order = await service.createOfflineOrder(
        input({
          customer: { action: 'create', firstName: 'Zoya', phone: '9820033445', email: 'Zoya@Example.com' },
        }),
      );
      expect(order.email).toBe('zoya@example.com');
      expect(usersRepo.users.find((u) => u.phone === '+919820033445')?.email).toBe('zoya@example.com');
    });

    it('throws INVALID_PHONE for an undeliverable number', async () => {
      await expect(
        service.createOfflineOrder(input({ customer: { action: 'create', firstName: 'X', phone: '12345' } })),
      ).rejects.toMatchObject({ code: 'INVALID_PHONE' });
      expect(ordersRepo.orders).toHaveLength(0);
    });

    it('propagates PHONE_TAKEN for a duplicate phone', async () => {
      await expect(
        service.createOfflineOrder(
          input({ customer: { action: 'create', firstName: 'Dupe', phone: '98200 00000' } }),
        ),
      ).rejects.toMatchObject({ code: 'PHONE_TAKEN' });
      expect(ordersRepo.orders).toHaveLength(0);
    });

    it('the stated total wins over the items sum', async () => {
      const order = await service.createOfflineOrder(
        input({
          items: [
            { description: 'Gown', quantity: 1, unitPrice: 9000000 },
            { description: 'Dupatta', quantity: 2, unitPrice: 500000 },
          ],
          total: 9800000, // handwritten bill says ₹98,000 — not 1,00,00,000 paise
        }),
      );
      expect(order.subtotal).toBe(10000000);
      expect(order.total).toBe(9800000);
      expect(order.balance).toBe(9800000);
    });

    it('records the advance as a receipt inside the same creation', async () => {
      const order = await service.createOfflineOrder(
        input({ advance: { amount: 5000000, mode: 'cash' }, gstAmount: 750000 }),
      );
      expect(order.advancePaid).toBe(5000000);
      expect(order.balance).toBe(10000000);
      expect(order.gstAmount).toBe(750000);
      expect(order.receipts).toHaveLength(1);
      expect(order.receipts[0]).toMatchObject({ orderId: order.id, amount: 5000000, mode: 'cash' });
      expect(await receiptsRepo.sumByOrder(order.id)).toBe(5000000);
    });

    it('rejects an advance above the stated total with OVER_COLLECTION', async () => {
      await expect(
        service.createOfflineOrder(input({ advance: { amount: 15000001, mode: 'online' } })),
      ).rejects.toMatchObject({ code: 'OVER_COLLECTION' });
      expect(ordersRepo.orders).toHaveLength(0);
      expect(receiptsRepo.receipts).toHaveLength(0);
    });

    it('supports a delivered exhibition spot sale', async () => {
      const order = await service.createOfflineOrder(
        input({
          channel: 'exhibition',
          initialStatus: 'delivered',
          advance: { amount: 15000000, mode: 'online' },
        }),
      );
      expect(order.status).toBe('delivered');
      expect(order.channel).toBe('exhibition');
      expect(order.balance).toBe(0);
    });

    it('stores deliveryDueDate and notes', async () => {
      const order = await service.createOfflineOrder(
        input({ deliveryDueDate: '2026-08-15', notes: 'Blouse to be altered' }),
      );
      expect(order.deliveryDueDate).toBe('2026-08-15');
      expect(order.notes).toBe('Blouse to be altered');
    });

    it('throws EMPTY_ORDER for no items', async () => {
      await expect(service.createOfflineOrder(input({ items: [] }))).rejects.toMatchObject({
        code: 'EMPTY_ORDER',
      });
    });

    it('never touches stock', async () => {
      await service.createOfflineOrder(input());
      const [v] = await products.getVariantsForUpdate({}, [sageM().id]);
      expect(v.stock).toBe(3);
    });
  });

  describe('channel-aware cancel', () => {
    it('cancels an offline order from in_atelier without restocking anything', async () => {
      const order = await service.createOfflineOrder(input());
      const cancelled = await service.updateStatus(order.id, 'cancelled');
      expect(cancelled.status).toBe('cancelled');
      const [v] = await products.getVariantsForUpdate({}, [sageM().id]);
      expect(v.stock).toBe(3); // untouched — offline lines never held stock
    });

    it('cancels an offline order from quality_check', async () => {
      const order = await service.createOfflineOrder(input());
      await service.updateStatus(order.id, 'quality_check');
      expect((await service.cancelOrder(order.id)).status).toBe('cancelled');
    });

    it('refuses to cancel an offline order once dispatched or delivered', async () => {
      const order = await service.createOfflineOrder(input());
      await service.updateStatus(order.id, 'quality_check');
      await service.updateStatus(order.id, 'dispatched');
      await expect(service.cancelOrder(order.id)).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });

      const sale = await service.createOfflineOrder(input({ initialStatus: 'delivered' }));
      await expect(service.cancelOrder(sale.id)).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    });

    it('online orders keep the old rule: cancellable early, restocks variants', async () => {
      const online = await service.createOrder({
        customer: {
          email: 'guest@example.com',
          firstName: 'Guest',
          addressLine1: '12 Marine Drive',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
        },
        deliveryMethod: 'standard',
        items: [{ variantId: sageM().id, quantity: 2 }],
      });
      const cancelled = await service.cancelOrder(online.id);
      expect(cancelled.status).toBe('cancelled');
      const [v] = await products.getVariantsForUpdate({}, [sageM().id]);
      expect(v.stock).toBe(3); // 3 − 2 + 2

      // and an online order deep in production still cannot be cancelled
      const another = await service.createOrder({
        customer: {
          email: 'guest@example.com',
          firstName: 'Guest',
          addressLine1: '12 Marine Drive',
          city: 'Mumbai',
          state: 'Maharashtra',
          pincode: '400001',
        },
        deliveryMethod: 'standard',
        items: [{ variantId: sageM().id, quantity: 1 }],
      });
      await service.updateStatus(another.id, 'paid');
      await service.updateStatus(another.id, 'in_atelier');
      await expect(service.cancelOrder(another.id)).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    });
  });

  describe('transitions from in_atelier', () => {
    it('walks in_atelier → quality_check → dispatched → delivered', async () => {
      const order = await service.createOfflineOrder(input());
      for (const status of ['quality_check', 'dispatched', 'delivered'] as const) {
        expect((await service.updateStatus(order.id, status)).status).toBe(status);
      }
    });

    it('rejects skipping ahead', async () => {
      const order = await service.createOfflineOrder(input());
      await expect(service.updateStatus(order.id, 'delivered')).rejects.toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
      });
    });
  });

  describe('recordReceipt', () => {
    it('adds receipts until the balance reaches zero', async () => {
      const order = await service.createOfflineOrder(input({ advance: { amount: 5000000, mode: 'cash' } }));
      const after = await service.recordReceipt(order.id, {
        amount: 10000000,
        mode: 'online',
        receivedAt: '2026-08-01',
        note: 'Final payment',
      });
      expect(after.advancePaid).toBe(15000000);
      expect(after.balance).toBe(0);
      expect(after.receipts).toHaveLength(2);
      expect(after.receipts[1]).toMatchObject({ receivedAt: '2026-08-01', note: 'Final payment' });
    });

    it('rejects over-collection with OVER_COLLECTION', async () => {
      const order = await service.createOfflineOrder(input({ advance: { amount: 5000000, mode: 'cash' } }));
      await expect(
        service.recordReceipt(order.id, { amount: 10000001, mode: 'cash' }),
      ).rejects.toMatchObject({ code: 'OVER_COLLECTION' });
      expect((await ordersRepo.getById(order.id))!.advancePaid).toBe(5000000);
    });

    it('throws NOT_FOUND for an unknown order', async () => {
      await expect(service.recordReceipt('ghost', { amount: 1, mode: 'cash' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('updateOrderDetails', () => {
    it('patches only the given fields', async () => {
      const order = await service.createOfflineOrder(input({ notes: 'original' }));
      const patched = await service.updateOrderDetails(order.id, {
        deliveryDueDate: '2026-09-01',
        gstAmount: 800000,
      });
      expect(patched).toMatchObject({
        deliveryDueDate: '2026-09-01',
        gstAmount: 800000,
        notes: 'original',
        billNumber: 'GST-042',
      });
      const cleared = await service.updateOrderDetails(order.id, { deliveryDueDate: null, notes: '' });
      expect(cleared.deliveryDueDate).toBeNull();
      expect(cleared.notes).toBe('');
    });

    it('throws NOT_FOUND for an unknown order', async () => {
      await expect(service.updateOrderDetails('ghost', { notes: 'x' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });
});
