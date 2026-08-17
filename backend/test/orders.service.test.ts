import { beforeEach, describe, expect, it } from 'vitest';
import {
  CreateOrderInput,
  OrdersService,
  createOrdersService,
  requesterOwnsOrder,
} from '../src/services/orders.service';
import type { Order } from '../src/types';
import { FakeEventsRepo, FakeOrdersRepo, FakeProductsRepo, FakeReceiptsRepo, FakeUsersRepo, fakeTx, seedCatalog, seedSetProduct } from './fakes';

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

    it('sells past zero — made-to-order stock goes negative and cancel restores it', async () => {
      const order = await service.createOrder(
        input({ items: [{ variantId: sageM().id, quantity: 1 }, { variantId: mossS().id, quantity: 2 }] }),
      );
      expect(ordersRepo.orders).toHaveLength(1);
      const [sage] = await products.getVariantsForUpdate({}, [sageM().id]);
      const [moss] = await products.getVariantsForUpdate({}, [mossS().id]);
      expect(sage.stock).toBe(2);
      expect(moss.stock).toBe(-1); // negative = the atelier's cut-to-order backlog
      await service.cancelOrder(order.id);
      const [sageAfter] = await products.getVariantsForUpdate({}, [sageM().id]);
      const [mossAfter] = await products.getVariantsForUpdate({}, [mossS().id]);
      expect(sageAfter.stock).toBe(3);
      expect(mossAfter.stock).toBe(1);
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

  describe('createOrder → server-stamped order_created event', () => {
    const ANALYTICS = {
      visitorId: '11111111-1111-1111-1111-111111111111',
      sessionId: '22222222-2222-2222-2222-222222222222',
    };

    function serviceWith(events: Parameters<typeof createOrdersService>[0]['events']) {
      return createOrdersService({
        products,
        orders: ordersRepo,
        users: new FakeUsersRepo(ordersRepo),
        receipts: new FakeReceiptsRepo(ordersRepo),
        events,
        runInTransaction: fakeTx,
      } as Parameters<typeof createOrdersService>[0]);
    }

    it('emits order_created with the orderId after a successful order', async () => {
      const events = new FakeEventsRepo();
      const order = await serviceWith(events).createOrder(
        input({ analytics: ANALYTICS, ip: '203.0.113.9', userId: 'user-42' }),
      );
      expect(events.rows).toHaveLength(1);
      expect(events.rows[0]).toMatchObject({
        eventType: 'order_created',
        visitorId: ANALYTICS.visitorId,
        sessionId: ANALYTICS.sessionId,
        userId: 'user-42',
        orderId: order.id,
        ip: '203.0.113.9',
        path: null,
        productId: null,
        props: { orderNumber: order.orderNumber, total: order.total },
      });
    });

    it('an analytics failure never fails the order', async () => {
      const failing = {
        insertServerEvent: async () => {
          throw new Error('events table on fire');
        },
      };
      const order = await serviceWith(failing).createOrder(input({ analytics: ANALYTICS }));
      expect(order.status).toBe('pending_payment');
      expect(ordersRepo.orders).toHaveLength(1);
    });

    it('emits nothing when analytics ids are absent', async () => {
      const events = new FakeEventsRepo();
      await serviceWith(events).createOrder(input());
      expect(events.rows).toHaveLength(0);
    });

    it('emits nothing when the order itself fails (no event before the commit)', async () => {
      const events = new FakeEventsRepo();
      await expect(
        serviceWith(events).createOrder(
          input({ analytics: ANALYTICS, items: [{ variantId: 'ghost', quantity: 1 }] }),
        ),
      ).rejects.toMatchObject({ code: 'NOT_FOUND' });
      expect(events.rows).toHaveLength(0);
    });
  });

  describe('set components (optional add-on pieces)', () => {
    // Fern Zardozi Set: base 15000000; Lehenga (required), Dupatta 1200000 and
    // Jacket 2400000 (both optional); M stock 10.
    let setVariantId: string;

    beforeEach(async () => {
      const set = await seedSetProduct(products, seeded.lehengas.id);
      setVariantId = set.variants[0].id;
    });

    it('includes every optional piece by default and snapshots the kept prices', async () => {
      const order = await service.createOrder(input({ items: [{ variantId: setVariantId, quantity: 1 }] }));
      expect(order.items[0].unitPrice).toBe(15000000 + 1200000 + 2400000);
      // Required pieces (Lehenga) never appear — their cost is the base price.
      expect(order.items[0].components).toEqual([
        { name: 'Dupatta', price: 1200000 },
        { name: 'Jacket', price: 2400000 },
      ]);
      expect(order.subtotal).toBe(18600000);
    });

    it('reprices when a piece is excluded and drops it from the snapshot', async () => {
      const order = await service.createOrder(
        input({ items: [{ variantId: setVariantId, quantity: 2, excludedComponents: ['Jacket'] }] }),
      );
      expect(order.items[0].unitPrice).toBe(15000000 + 1200000);
      expect(order.items[0].components).toEqual([{ name: 'Dupatta', price: 1200000 }]);
      expect(order.subtotal).toBe(2 * 16200000);
    });

    it('matches exclusions trim- and case-insensitively', async () => {
      const order = await service.createOrder(
        input({ items: [{ variantId: setVariantId, quantity: 1, excludedComponents: ['  jAcKeT '] }] }),
      );
      expect(order.items[0].unitPrice).toBe(15000000 + 1200000);
      expect(order.items[0].components).toEqual([{ name: 'Dupatta', price: 1200000 }]);
    });

    it('ignores exclusions the product does not have', async () => {
      const order = await service.createOrder(
        input({ items: [{ variantId: sageM().id, quantity: 1, excludedComponents: ['Dupatta', 'Cape'] }] }),
      );
      expect(order.items[0].unitPrice).toBe(18400000);
      expect(order.items[0].components).toEqual([]);
    });

    it('keeps the same variant with different exclusions as separate lines but aggregates stock', async () => {
      const order = await service.createOrder(
        input({
          items: [
            { variantId: setVariantId, quantity: 1 },
            { variantId: setVariantId, quantity: 1, excludedComponents: ['Dupatta', 'Jacket'] },
            { variantId: setVariantId, quantity: 1 }, // merges with the first line
          ],
        }),
      );
      expect(order.items).toHaveLength(2);
      const full = order.items.find((i) => i.components.length > 0)!;
      const bare = order.items.find((i) => i.components.length === 0)!;
      expect(full.quantity).toBe(2);
      expect(full.unitPrice).toBe(18600000);
      expect(bare.quantity).toBe(1);
      expect(bare.unitPrice).toBe(15000000);
      expect(order.subtotal).toBe(2 * 18600000 + 15000000);
      const [v] = await products.getVariantsForUpdate({}, [setVariantId]);
      expect(v.stock).toBe(7); // 10 - 3 across both combos
    });

    it('aggregates stock across combos of the same variant, past zero', async () => {
      await service.createOrder(
        input({
          items: [
            { variantId: setVariantId, quantity: 6 },
            { variantId: setVariantId, quantity: 5, excludedComponents: ['Jacket'] },
          ],
        }),
      );
      const [v] = await products.getVariantsForUpdate({}, [setVariantId]);
      expect(v.stock).toBe(-1); // 10 - 11
    });

    it('honours a matching expectedUnitPrice and 409s a stale one', async () => {
      const ok = await service.createOrder(
        input({ items: [{ variantId: setVariantId, quantity: 1, expectedUnitPrice: 18600000 }] }),
      );
      expect(ok.items[0].unitPrice).toBe(18600000);

      // A cart that displayed a price the server no longer computes — e.g. an
      // exclusion invalidated by a component rename — must never be charged.
      await expect(
        service.createOrder(
          input({
            items: [
              { variantId: setVariantId, quantity: 1, excludedComponents: ['Longline Jacket'], expectedUnitPrice: 16200000 },
            ],
          }),
        ),
      ).rejects.toMatchObject({ code: 'PRICE_CHANGED' });
    });

    it('legacy (pre-components) items are priced only on dupatta/jacket — never an invisible piece', async () => {
      const caped = await products.createProduct({
        categoryId: seeded.lehengas.id,
        slug: 'caped-set',
        name: 'Caped Set',
        description: 'Set with a cape the old storefront never displayed.',
        details: 'Dry clean only',
        price: 10000000,
        color: 'Sage',
        active: true,
        components: [
          { name: 'Dupatta', optional: true, price: 500000 },
          { name: 'Cape', optional: true, price: 2000000 },
        ],
        variants: [{ size: 'M', stock: 5 }],
      });
      const order = await service.createOrder(
        input({
          items: [{ variantId: caped.variants[0].id, quantity: 1, legacyIncludes: { dupatta: true, jacket: true } }],
        }),
      );
      // Dupatta honoured, Cape (invisible to the old UI) not charged.
      expect(order.items[0].unitPrice).toBe(10000000 + 500000);
      expect(order.items[0].components).toEqual([{ name: 'Dupatta', price: 500000 }]);
    });

    it('merges combos that price out identically — phantom exclusions from migrated carts', async () => {
      const order = await service.createOrder(
        input({
          items: [
            { variantId: setVariantId, quantity: 1, excludedComponents: ['Odhani'] }, // unknown name, ignored
            { variantId: setVariantId, quantity: 1 },
          ],
        }),
      );
      expect(order.items).toHaveLength(1);
      expect(order.items[0].quantity).toBe(2);
      expect(order.items[0].unitPrice).toBe(18600000);
    });
  });

  describe('made-to-measure measurements', () => {
    it('persists the trimmed note on its line and defaults to empty', async () => {
      const order = await service.createOrder(
        input({
          items: [
            { variantId: sageCustom().id, quantity: 1, measurements: '  bust 36 waist 30  ' },
            { variantId: sageM().id, quantity: 1 },
          ],
        }),
      );
      expect(order.items).toHaveLength(2);
      const custom = order.items.find((i) => i.variantId === sageCustom().id)!;
      const plain = order.items.find((i) => i.variantId === sageM().id)!;
      expect(custom.measurements).toBe('bust 36 waist 30');
      expect(plain.measurements).toBe('');
    });

    it('merges lines with the identical note', async () => {
      const order = await service.createOrder(
        input({
          items: [
            { variantId: sageCustom().id, quantity: 1, measurements: 'bust 36' },
            { variantId: sageCustom().id, quantity: 2, measurements: 'bust 36' },
          ],
        }),
      );
      expect(order.items).toHaveLength(1);
      expect(order.items[0].quantity).toBe(3);
      expect(order.items[0].measurements).toBe('bust 36');
    });

    it('keeps different notes as separate lines but aggregates stock', async () => {
      const order = await service.createOrder(
        input({
          items: [
            { variantId: sageCustom().id, quantity: 1, measurements: 'bust 36' },
            { variantId: sageCustom().id, quantity: 1, measurements: 'bust 38' },
            { variantId: sageCustom().id, quantity: 1 }, // no note — a third line
          ],
        }),
      );
      expect(order.items).toHaveLength(3);
      expect(order.items.map((i) => i.measurements).sort()).toEqual(['', 'bust 36', 'bust 38']);
      const [v] = await products.getVariantsForUpdate({}, [sageCustom().id]);
      expect(v.stock).toBe(47); // 50 - 3 across all note combos
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
        components: [
          { name: 'Dupatta', optional: true, price: 1200000 },
          { name: 'Jacket', optional: true, price: 2400000 },
        ],
        variants: [{ size: 'M', stock: 5 }],
      });
      const order = await service.createOrder(
        input({ items: [{ variantId: sale.variants[0].id, quantity: 2 }] }),
      );
      expect(order.items[0].unitPrice).toBe(15000000 + 1200000 + 2400000);
      expect(order.items[0].components[0]).toEqual({ name: 'Dupatta', price: 1200000 });
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
