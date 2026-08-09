import { beforeEach, describe, expect, it } from 'vitest';
import {
  CreateOrderInput,
  OrdersService,
  createOrdersService,
  requesterOwnsOrder,
} from '../src/services/orders.service';
import type { Order } from '../src/types';
import { FakeOrdersRepo, FakeProductsRepo, FakeReceiptsRepo, FakeUsersRepo, fakeTx, seedCatalog, seedSetProduct } from './fakes';

const customer = {
  email: 'Guest@Example.com',
  phone: '+91 98765 43210',
  firstName: 'Guest',
  lastName: 'Shopper',
  addressLine1: '12 Marine Drive',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400001',
};

describe('OrdersService', () => {
  let products: FakeProductsRepo;
  let ordersRepo: FakeOrdersRepo;
  let service: OrdersService;
  let seeded: Awaited<ReturnType<typeof seedCatalog>>;

  const sageM = () => seeded.sage.variants[0]; // stock 3
  const sageCustom = () => seeded.sage.variants[1]; // stock 50
  const mossS = () => seeded.moss.variants[0]; // stock 1

  function input(over: Partial<CreateOrderInput> = {}): CreateOrderInput {
    return {
      customer,
      deliveryMethod: 'standard',
      items: [{ variantId: sageM().id, quantity: 1 }],
      ...over,
    };
  }

  beforeEach(async () => {
    products = new FakeProductsRepo();
    seeded = await seedCatalog(products);
    ordersRepo = new FakeOrdersRepo();
    service = createOrdersService({
      products,
      orders: ordersRepo,
      users: new FakeUsersRepo(ordersRepo),
      receipts: new FakeReceiptsRepo(ordersRepo),
      runInTransaction: fakeTx,
    });
  });

  describe('createOrder', () => {
    it('creates a pending_payment order priced from the DB', async () => {
      const order = await service.createOrder(
        input({ items: [{ variantId: sageM().id, quantity: 2 }, { variantId: mossS().id, quantity: 1 }] }),
      );
      expect(order.status).toBe('pending_payment');
      expect(order.subtotal).toBe(2 * 18400000 + 9600000);
      expect(order.deliveryFee).toBe(0);
      expect(order.total).toBe(order.subtotal);
      expect(order.userId).toBeNull();
      expect(order.email).toBe('guest@example.com'); // normalized
      expect(order.items).toHaveLength(2);
      const sageItem = order.items.find((i) => i.variantId === sageM().id)!;
      expect(sageItem).toMatchObject({
        productName: 'Sage Sequin Jacket Lehenga',
        size: 'M',
        color: 'Sage',
        unitPrice: 18400000,
        quantity: 2,
      });
    });

    it('formats order numbers as TA-2026-NNNNN and increments them', async () => {
      const a = await service.createOrder(input());
      const b = await service.createOrder(input());
      expect(a.orderNumber).toBe('TA-2026-04818');
      expect(b.orderNumber).toBe('TA-2026-04819');
    });

    it('charges 250000 paise for priority delivery', async () => {
      const order = await service.createOrder(input({ deliveryMethod: 'priority' }));
      expect(order.deliveryFee).toBe(250000);
      expect(order.total).toBe(order.subtotal + 250000);
    });

    it('decrements stock atomically per variant', async () => {
      await service.createOrder(input({ items: [{ variantId: sageM().id, quantity: 2 }] }));
      const [v] = await products.getVariantsForUpdate({}, [sageM().id]);
      expect(v.stock).toBe(1);
    });

    it('merges duplicate variant lines', async () => {
      const order = await service.createOrder(
        input({ items: [{ variantId: sageM().id, quantity: 1 }, { variantId: sageM().id, quantity: 2 }] }),
      );
      expect(order.items).toHaveLength(1);
      expect(order.items[0].quantity).toBe(3);
      const [v] = await products.getVariantsForUpdate({}, [sageM().id]);
      expect(v.stock).toBe(0);
    });

    it('throws EMPTY_ORDER for no items', async () => {
      await expect(service.createOrder(input({ items: [] }))).rejects.toMatchObject({ code: 'EMPTY_ORDER' });
    });

    it('throws INSUFFICIENT_STOCK without decrementing anything', async () => {
      await expect(
        service.createOrder(
          input({ items: [{ variantId: sageM().id, quantity: 1 }, { variantId: mossS().id, quantity: 2 }] }),
        ),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
      const [sage] = await products.getVariantsForUpdate({}, [sageM().id]);
      const [moss] = await products.getVariantsForUpdate({}, [mossS().id]);
      expect(sage.stock).toBe(3);
      expect(moss.stock).toBe(1);
      expect(ordersRepo.orders).toHaveLength(0);
    });

    it('throws NOT_FOUND for unknown variants', async () => {
      await expect(
        service.createOrder(input({ items: [{ variantId: 'ghost', quantity: 1 }] })),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('attaches the userId for logged-in orders', async () => {
      const order = await service.createOrder(input({ userId: 'user-42' }));
      expect(order.userId).toBe('user-42');
    });

    it('allows ordering the full Custom stock', async () => {
      const order = await service.createOrder(input({ items: [{ variantId: sageCustom().id, quantity: 50 }] }));
      expect(order.items[0].quantity).toBe(50);
      const [v] = await products.getVariantsForUpdate({}, [sageCustom().id]);
      expect(v.stock).toBe(0);
    });
  });

  describe('set includes (dupatta/jacket add-ons)', () => {
    // Fern Zardozi Set: base 15000000, dupatta 1200000, jacket 2400000, M stock 10.
    let setVariantId: string;

    beforeEach(async () => {
      const set = await seedSetProduct(products, seeded.lehengas.id);
      setVariantId = set.variants[0].id;
    });

    it('includes both pieces by default and snapshots the chosen prices', async () => {
      const order = await service.createOrder(input({ items: [{ variantId: setVariantId, quantity: 1 }] }));
      expect(order.items[0].unitPrice).toBe(15000000 + 1200000 + 2400000);
      expect(order.items[0].dupattaPrice).toBe(1200000);
      expect(order.items[0].jacketPrice).toBe(2400000);
      expect(order.subtotal).toBe(18600000);
    });

    it('reprices when a piece is opted out and snapshots null for it', async () => {
      const order = await service.createOrder(
        input({ items: [{ variantId: setVariantId, quantity: 2, includeJacket: false }] }),
      );
      expect(order.items[0].unitPrice).toBe(15000000 + 1200000);
      expect(order.items[0].dupattaPrice).toBe(1200000);
      expect(order.items[0].jacketPrice).toBeNull();
      expect(order.subtotal).toBe(2 * 16200000);
    });

    it('ignores includes on products without those set pieces', async () => {
      const order = await service.createOrder(
        input({ items: [{ variantId: sageM().id, quantity: 1, includeDupatta: true, includeJacket: true }] }),
      );
      expect(order.items[0].unitPrice).toBe(18400000);
      expect(order.items[0].dupattaPrice).toBeNull();
      expect(order.items[0].jacketPrice).toBeNull();
    });

    it('keeps the same variant with different includes as separate lines but aggregates stock', async () => {
      const order = await service.createOrder(
        input({
          items: [
            { variantId: setVariantId, quantity: 1 },
            { variantId: setVariantId, quantity: 1, includeDupatta: false, includeJacket: false },
            { variantId: setVariantId, quantity: 1 }, // merges with the first line
          ],
        }),
      );
      expect(order.items).toHaveLength(2);
      const full = order.items.find((i) => i.dupattaPrice !== null)!;
      const bare = order.items.find((i) => i.dupattaPrice === null)!;
      expect(full.quantity).toBe(2);
      expect(full.unitPrice).toBe(18600000);
      expect(bare.quantity).toBe(1);
      expect(bare.unitPrice).toBe(15000000);
      expect(order.subtotal).toBe(2 * 18600000 + 15000000);
      const [v] = await products.getVariantsForUpdate({}, [setVariantId]);
      expect(v.stock).toBe(7); // 10 - 3 across both combos
    });

    it('checks stock across combos of the same variant', async () => {
      await expect(
        service.createOrder(
          input({
            items: [
              { variantId: setVariantId, quantity: 6 },
              { variantId: setVariantId, quantity: 5, includeJacket: false },
            ],
          }),
        ),
      ).rejects.toMatchObject({ code: 'INSUFFICIENT_STOCK' });
    });
  });

  describe('sale pricing', () => {
    // The discount lives in the repo's unit_price CASE, so the service prices a
    // sale piece correctly without knowing sales exist. Add-ons stay full price.
    it('charges the sale price for the base garment and full price for add-ons', async () => {
      const sale = await products.createProduct({
        categoryId: seeded.lehengas.id,
        slug: 'sale-mirror-set',
        name: 'Sale Mirror Set',
        description: 'On sale this season.',
        details: 'Dry clean only',
        price: 20000000,
        salePrice: 15000000,
        flag: 'sale',
        color: 'Sage',
        dupattaPrice: 1200000,
        jacketPrice: 2400000,
        variants: [{ size: 'M', stock: 5 }],
      });
      const order = await service.createOrder(
        input({ items: [{ variantId: sale.variants[0].id, quantity: 2 }] }),
      );
      expect(order.items[0].unitPrice).toBe(15000000 + 1200000 + 2400000);
      expect(order.items[0].dupattaPrice).toBe(1200000);
      expect(order.subtotal).toBe(2 * 18600000);
    });

    it('ignores a stale salePrice once the piece is off sale', async () => {
      const off = await products.createProduct({
        categoryId: seeded.lehengas.id,
        slug: 'ex-sale-lehenga',
        name: 'Ex Sale Lehenga',
        description: 'The sale ended.',
        details: 'Dry clean only',
        price: 20000000,
        salePrice: 15000000,
        flag: null,
        color: 'Sage',
        variants: [{ size: 'M', stock: 5 }],
      });
      const order = await service.createOrder(input({ items: [{ variantId: off.variants[0].id, quantity: 1 }] }));
      expect(order.items[0].unitPrice).toBe(20000000);
    });
  });

  describe('getOrderForRequester', () => {
    it('returns the order for a matching user', async () => {
      const order = await service.createOrder(input({ userId: 'user-1' }));
      const found = await service.getOrderForRequester(order.orderNumber, { userId: 'user-1' });
      expect(found.id).toBe(order.id);
    });

    it('returns the order for a matching email, case-insensitively', async () => {
      const order = await service.createOrder(input());
      const found = await service.getOrderForRequester(order.orderNumber, { email: ' GUEST@example.com ' });
      expect(found.id).toBe(order.id);
    });

    it('404s for wrong user, wrong email, missing requester and unknown number alike', async () => {
      const order = await service.createOrder(input({ userId: 'user-1' }));
      for (const requester of [{ userId: 'user-2' }, { email: 'other@example.com' }, {}]) {
        await expect(service.getOrderForRequester(order.orderNumber, requester)).rejects.toMatchObject({
          code: 'NOT_FOUND',
        });
      }
      await expect(service.getOrderForRequester('TA-2026-99999', { userId: 'user-1' })).rejects.toMatchObject({
        code: 'NOT_FOUND',
      });
    });
  });

  describe('listUserOrders', () => {
    it('lists only the given user’s orders', async () => {
      await service.createOrder(input({ userId: 'user-1' }));
      await service.createOrder(input({ userId: 'user-2' }));
      const orders = await service.listUserOrders('user-1');
      expect(orders).toHaveLength(1);
      expect(orders[0].userId).toBe('user-1');
    });
  });

  describe('cancelOrder', () => {
    it('cancels a pending_payment order and restocks its items', async () => {
      const order = await service.createOrder(input({ items: [{ variantId: sageM().id, quantity: 2 }] }));
      const cancelled = await service.cancelOrder(order.id);
      expect(cancelled.status).toBe('cancelled');
      const [v] = await products.getVariantsForUpdate({}, [sageM().id]);
      expect(v.stock).toBe(3);
    });

    it('cancels a paid order too', async () => {
      const order = await service.createOrder(input());
      await service.updateStatus(order.id, 'paid');
      expect((await service.cancelOrder(order.id)).status).toBe('cancelled');
    });

    it('refuses to cancel beyond paid', async () => {
      const order = await service.createOrder(input());
      await service.updateStatus(order.id, 'paid');
      await service.updateStatus(order.id, 'in_atelier');
      await expect(service.cancelOrder(order.id)).rejects.toMatchObject({ code: 'INVALID_STATUS_TRANSITION' });
    });

    it('throws NOT_FOUND for an unknown order', async () => {
      await expect(service.cancelOrder('ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('updateStatus', () => {
    it('walks the full happy-path transition chain', async () => {
      const order = await service.createOrder(input());
      for (const status of ['paid', 'in_atelier', 'quality_check', 'dispatched', 'delivered'] as const) {
        expect((await service.updateStatus(order.id, status)).status).toBe(status);
      }
    });

    it('rejects invalid transitions', async () => {
      const order = await service.createOrder(input());
      await expect(service.updateStatus(order.id, 'dispatched')).rejects.toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
      });
      await service.updateStatus(order.id, 'paid');
      await expect(service.updateStatus(order.id, 'delivered')).rejects.toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
      });
      await expect(service.updateStatus(order.id, 'pending_payment')).rejects.toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
      });
    });

    it('terminal states allow no transitions', async () => {
      const order = await service.createOrder(input());
      await service.cancelOrder(order.id);
      await expect(service.updateStatus(order.id, 'paid')).rejects.toMatchObject({
        code: 'INVALID_STATUS_TRANSITION',
      });
    });

    it('updating to cancelled restocks via the cancel path', async () => {
      const order = await service.createOrder(input({ items: [{ variantId: sageM().id, quantity: 3 }] }));
      const [before] = await products.getVariantsForUpdate({}, [sageM().id]);
      expect(before.stock).toBe(0);
      const cancelled = await service.updateStatus(order.id, 'cancelled');
      expect(cancelled.status).toBe('cancelled');
      const [after] = await products.getVariantsForUpdate({}, [sageM().id]);
      expect(after.stock).toBe(3);
    });

    it('throws NOT_FOUND for an unknown order', async () => {
      await expect(service.updateStatus('ghost', 'paid')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });
  });

  describe('requesterOwnsOrder', () => {
    const orderWith = (over: Partial<Order>): Order =>
      ({ userId: null, email: 'owner@example.com', ...over }) as Order;

    it('matches by user id or by email (case-insensitive)', () => {
      expect(requesterOwnsOrder(orderWith({ userId: 'u1' }), { userId: 'u1' })).toBe(true);
      expect(requesterOwnsOrder(orderWith({}), { email: ' Owner@Example.COM ' })).toBe(true);
      expect(requesterOwnsOrder(orderWith({}), { email: 'other@example.com' })).toBe(false);
      expect(requesterOwnsOrder(orderWith({ userId: 'u1' }), { userId: 'u2' })).toBe(false);
    });

    it('never matches an empty-email order by email (offline orders carry no email)', () => {
      expect(requesterOwnsOrder(orderWith({ email: '' }), { email: '' })).toBe(false);
      expect(requesterOwnsOrder(orderWith({ email: '' }), { email: '  ' })).toBe(false);
      expect(requesterOwnsOrder(orderWith({ email: '', userId: 'u1' }), { userId: 'u1' })).toBe(true);
    });
  });
});
