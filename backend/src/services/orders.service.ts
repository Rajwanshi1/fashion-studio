import type { DocumentsRepo } from '../data/documents.repo';
import type { EventsRepo } from '../data/events.repo';
import type { MeasurementsRepo } from '../data/measurements.repo';
import type { OrderDetailsPatch, OrdersRepo } from '../data/orders.repo';
import type { ProductsRepo, VariantForOrder } from '../data/products.repo';
import type { ReceiptsRepo } from '../data/receipts.repo';
import type { UsersRepo } from '../data/users.repo';
import { normalizePhone } from '../lib/phone';
import {
  BillType,
  DeliveryMethod,
  DomainError,
  Order,
  OrderChannel,
  OrderStatus,
  ReceiptMode,
  TxRunner,
  User,
} from '../types';

export interface CreateOrderInput {
  userId?: string | null;
  customer: {
    email: string;
    phone?: string;
    firstName: string;
    lastName?: string;
    addressLine1: string;
    addressLine2?: string;
    city: string;
    state: string;
    pincode: string;
    country?: string;
  };
  deliveryMethod: DeliveryMethod;
  items: {
    variantId: string;
    quantity: number;
    /** Names of the optional set pieces the shopper UNTICKED — everything else
     *  is included. Matched trim/case-insensitively against the product's
     *  optional components; unknown names are ignored (any resulting price
     *  disagreement is caught by expectedUnitPrice below). */
    excludedComponents?: string[];
    /** Paise; the per-unit price the shopper's cart displayed for this line.
     *  When present, the server refuses the order (PRICE_CHANGED) if its own
     *  pricing disagrees — a stale cart (renamed component, edited price,
     *  ended sale) can never be charged an amount it did not show. */
    expectedUnitPrice?: number;
    /** Set by the route for requests from the pre-components storefront, which
     *  only ever displayed dupatta/jacket add-ons — pricing is restricted to
     *  those two names so an invisible component is never charged. Removed
     *  with the legacy-column drop chore. */
    legacyIncludes?: { dupatta: boolean; jacket: boolean };
    /** Free-text made-to-measure note; part of line identity. */
    measurements?: string;
  }[];
  /** Tracker identity for the server-stamped order_created analytics event;
   *  absent (no event) when the client has no analytics ids to offer. */
  analytics?: { visitorId: string; sessionId: string } | null;
  /** First X-Forwarded-For hop, threaded from the route for that event. */
  ip?: string | null;
}

/** Manual entry of a handwritten bill (in-store, Instagram DM, exhibition). */
export interface CreateOfflineOrderInput {
  channel: Exclude<OrderChannel, 'online'>;
  billType: BillType;
  billNumber?: string;
  customer:
    | { action: 'link'; userId: string }
    | {
        action: 'create';
        firstName: string;
        lastName?: string;
        phone: string;
        email?: string;
        addressLine1?: string;
        addressLine2?: string;
        city?: string;
        state?: string;
        pincode?: string;
      };
  items: {
    description: string;
    quantity: number;
    unitPrice: number;
    /** Optional catalogue link — sent together, reserves stock on creation. */
    productId?: string;
    variantId?: string;
  }[];
  gstAmount?: number;
  /** Paise — the stated total wins (handwritten bills rarely sum exactly). */
  total: number;
  /** Creates the initial receipt in the same transaction. */
  advance?: { amount: number; mode: ReceiptMode };
  deliveryDueDate?: string;
  notes?: string;
  /** Default in_atelier; delivered = exhibition spot sale. */
  /** Any state a bill can arrive in — old bills are often entered after the fact. */
  initialStatus?: 'in_atelier' | 'quality_check' | 'dispatched' | 'delivered';
  /** Uploaded bill/measurement photos — confirmed + linked in the same transaction. */
  documentIds?: string[];
  /** Reviewed measurement sets, saved against the linked/created customer. */
  measurementSets?: {
    label?: string;
    /** Names/values verbatim from the page, e.g. { SH: '15 in' }. */
    data: Record<string, string>;
    notes?: string;
    documentId?: string | null;
  }[];
}

export interface RecordReceiptInput {
  amount: number;
  mode: ReceiptMode;
  receivedAt?: string;
  note?: string;
}

/** Who is asking for an order — a signed-in user (JWT) and/or a guest-supplied email. */
export interface OrderRequester {
  userId?: string | null;
  email?: string | null;
}

/** Guest-tracking ownership rule: the requester's user id or email must match the order. */
export function requesterOwnsOrder(order: Order, requester: OrderRequester): boolean {
  const matchesUser = !!requester.userId && order.userId === requester.userId;
  // Offline orders may carry an empty email — an empty match must never grant access.
  const matchesEmail =
    !!requester.email && !!order.email && order.email.toLowerCase() === requester.email.trim().toLowerCase();
  return matchesUser || matchesEmail;
}

export interface OrdersService {
  createOrder(input: CreateOrderInput): Promise<Order>;
  createOfflineOrder(input: CreateOfflineOrderInput): Promise<Order>;
  getOrderForRequester(orderNumber: string, requester: OrderRequester): Promise<Order>;
  listUserOrders(userId: string): Promise<Order[]>;
  cancelOrder(orderId: string): Promise<Order>;
  updateStatus(orderId: string, next: OrderStatus): Promise<Order>;
  recordReceipt(orderId: string, input: RecordReceiptInput): Promise<Order>;
  updateOrderDetails(orderId: string, patch: OrderDetailsPatch): Promise<Order>;
}

export const PRIORITY_DELIVERY_FEE = 250000; // ₹2,500 in paise

const TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['in_atelier', 'cancelled'],
  in_atelier: ['quality_check'],
  quality_check: ['dispatched'],
  dispatched: ['delivered'],
  delivered: [],
  cancelled: [],
};

const CANCELLABLE: OrderStatus[] = ['pending_payment', 'paid'];

// Offline orders were paid (at least partly) on paper — cancelling one is a
// bookkeeping correction, allowed deeper into production and never restocking.
const OFFLINE_CANCELLABLE: OrderStatus[] = ['in_atelier', 'quality_check'];

export function createOrdersService(deps: {
  products: ProductsRepo;
  orders: OrdersRepo;
  users: UsersRepo;
  receipts: ReceiptsRepo;
  documents: DocumentsRepo;
  measurements: MeasurementsRepo;
  /** Optional analytics sink for the server-stamped order_created event. */
  events?: Pick<EventsRepo, 'insertServerEvent'> | null;
  runInTransaction: TxRunner;
}): OrdersService {
  const service: OrdersService = {
    async createOrder(input) {
      // Merge duplicate lines per variant + set-selection + measurements combo:
      // the same variant with and without a dupatta — or with a different
      // made-to-measure note — is two distinct order lines.
      const combos = new Map<
        string,
        {
          variantId: string;
          excluded: Set<string>;
          expected: number | null;
          legacy: { dupatta: boolean; jacket: boolean } | null;
          measurements: string;
          qty: number;
        }
      >();
      for (const item of input.items ?? []) {
        // Everything is included unless explicitly unticked.
        const excluded = new Set(
          (item.excludedComponents ?? []).map((name) => name.trim().toLowerCase()).filter(Boolean),
        );
        const expected = item.expectedUnitPrice ?? null;
        const legacy = item.legacyIncludes ?? null;
        const measurements = (item.measurements ?? '').trim();
        const key = [
          item.variantId,
          [...excluded].sort().join(','),
          expected ?? '',
          legacy ? `L${legacy.dupatta ? 1 : 0}${legacy.jacket ? 1 : 0}` : '',
          measurements,
        ].join('|');
        const existing = combos.get(key);
        if (existing) existing.qty += item.quantity;
        else combos.set(key, { variantId: item.variantId, excluded, expected, legacy, measurements, qty: item.quantity });
      }
      if (combos.size === 0) {
        throw new DomainError('EMPTY_ORDER', 'Order must contain at least one item');
      }
      // Stock is held per variant, so aggregate across combos for the check.
      const quantities = new Map<string, number>();
      for (const combo of combos.values()) {
        quantities.set(combo.variantId, (quantities.get(combo.variantId) ?? 0) + combo.qty);
      }

      const created = await deps.runInTransaction(async (tx) => {
        const variantIds = [...quantities.keys()];
        const variants = await deps.products.getVariantsForUpdate(tx, variantIds);
        const byId = new Map(variants.map((v) => [v.id, v]));
        for (const id of variantIds) {
          if (!byId.has(id)) throw new DomainError('NOT_FOUND', 'One or more items are no longer available');
        }
        // Made to order: stock never gates a sale. Decrementing below zero is
        // deliberate — negative stock is the atelier's cut-to-order backlog.

        // Prices always come from the DB, never the client. An exclusion only
        // counts against optional priced pieces the product actually has.
        const priced = [...combos.values()].map((combo) => {
          const v = byId.get(combo.variantId)!;
          const optionalPriced = v.components.filter((c) => c.optional && c.price != null);
          const kept = (
            combo.legacy
              ? // The pre-components storefront only ever displayed (and priced)
                // dupatta and jacket — any other optional piece was invisible to
                // this shopper and must not be charged.
                optionalPriced.filter((c) => {
                  const name = c.name.trim().toLowerCase();
                  if (name === 'dupatta') return combo.legacy!.dupatta;
                  if (name === 'jacket') return combo.legacy!.jacket;
                  return false;
                })
              : optionalPriced.filter((c) => !combo.excluded.has(c.name.trim().toLowerCase()))
          ).map((c) => ({ name: c.name, price: c.price! }));
          const unitPrice = v.unitPrice + kept.reduce((sum, c) => sum + c.price, 0);
          // The one guard against a stale cart: the shopper is only ever
          // charged a per-unit price their cart actually displayed.
          if (combo.expected != null && combo.expected !== unitPrice) {
            throw new DomainError(
              'PRICE_CHANGED',
              `The price of ${v.productName} changed while you were shopping — please review your bag and try again`,
            );
          }
          return {
            productId: v.productId,
            variantId: v.id,
            productName: v.productName,
            size: v.size,
            color: v.color,
            unitPrice,
            quantity: combo.qty,
            imageUrl: v.imageUrl,
            components: kept,
            // Display-only free text — prices still come exclusively from the DB rows.
            measurements: combo.measurements,
          };
        });
        // Combos that priced out identically collapse into one order line —
        // e.g. a migrated cart line whose exclusions name pieces the product
        // never had alongside a fresh line for the same selection.
        const merged = new Map<string, (typeof priced)[number]>();
        for (const item of priced) {
          const key = [item.variantId, item.unitPrice, item.components.map((c) => c.name).join(','), item.measurements].join('|');
          const existing = merged.get(key);
          if (existing) existing.quantity += item.quantity;
          else merged.set(key, item);
        }
        const items = [...merged.values()];
        const subtotal = items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
        const deliveryFee = input.deliveryMethod === 'priority' ? PRIORITY_DELIVERY_FEE : 0;
        const orderNumber = await deps.orders.nextOrderNumber(tx);
        const { customer } = input;

        const order = await deps.orders.createWithItems(
          tx,
          {
            orderNumber,
            userId: input.userId ?? null,
            email: customer.email.trim().toLowerCase(),
            phone: customer.phone ?? '',
            firstName: customer.firstName,
            lastName: customer.lastName ?? '',
            addressLine1: customer.addressLine1,
            addressLine2: customer.addressLine2 ?? '',
            city: customer.city,
            state: customer.state,
            pincode: customer.pincode,
            country: customer.country ?? 'India',
            deliveryMethod: input.deliveryMethod,
            deliveryFee,
            subtotal,
            total: subtotal + deliveryFee,
            status: 'pending_payment',
          },
          items,
        );

        for (const [id, qty] of quantities) {
          await deps.products.decrementStock(tx, id, qty);
        }
        return order;
      });

      // Server-stamped conversion event, AFTER the commit — order_created is
      // not in the /track whitelist, so it can never be spoofed by a client.
      // An analytics failure must never fail a placed order.
      if (input.analytics && deps.events) {
        try {
          await deps.events.insertServerEvent({
            eventType: 'order_created',
            visitorId: input.analytics.visitorId,
            sessionId: input.analytics.sessionId,
            userId: input.userId ?? null,
            orderId: created.id,
            path: null,
            productId: null,
            ip: input.ip ?? null,
            props: { orderNumber: created.orderNumber, total: created.total },
          });
        } catch (err) {
          console.error('order_created analytics event failed:', err);
        }
      }
      return created;
    },

    async createOfflineOrder(input) {
      if (input.items.length === 0) {
        throw new DomainError('EMPTY_ORDER', 'Order must contain at least one item');
      }
      const subtotal = input.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
      if (input.advance && input.advance.amount > input.total) {
        throw new DomainError('OVER_COLLECTION', 'Advance cannot exceed the order total');
      }

      // Aggregate linked lines per variant — stock is checked and decremented
      // per variant, exactly like the online checkout.
      const linkedQuantities = new Map<string, number>();
      for (const it of input.items) {
        if (it.variantId) {
          linkedQuantities.set(it.variantId, (linkedQuantities.get(it.variantId) ?? 0) + it.quantity);
        }
      }

      return deps.runInTransaction(async (tx) => {
        const lockedVariants = new Map<string, VariantForOrder>();
        if (linkedQuantities.size > 0) {
          const variants = await deps.products.getVariantsForUpdate(tx, [...linkedQuantities.keys()]);
          for (const v of variants) lockedVariants.set(v.id, v);
          for (const it of input.items) {
            if (!it.variantId) continue;
            const v = lockedVariants.get(it.variantId);
            if (!v || (it.productId && v.productId !== it.productId)) {
              throw new DomainError('NOT_FOUND', 'A linked piece is no longer in the catalogue — unlink it to record the bill anyway');
            }
          }
          // No stock check: a paper bill records a sale that already happened,
          // and under made-to-order a 0-stock size is a legitimate commission.
        }

        let user: User;
        if (input.customer.action === 'link') {
          const found = await deps.users.findById(input.customer.userId);
          if (!found) throw new DomainError('NOT_FOUND', 'Customer not found');
          user = found;
        } else {
          const phone = normalizePhone(input.customer.phone);
          if (!phone) throw new DomainError('INVALID_PHONE', 'Enter a valid mobile number');
          user = await deps.users.create({
            email: input.customer.email?.trim().toLowerCase() || null,
            passwordHash: null,
            firstName: input.customer.firstName,
            lastName: input.customer.lastName ?? '',
            authProvider: 'otp',
            phone,
            phoneVerified: false,
          });
        }

        const customer = input.customer.action === 'create' ? input.customer : null;
        const orderNumber = await deps.orders.nextOrderNumber(tx);
        const order = await deps.orders.createOffline(
          tx,
          {
            orderNumber,
            userId: user.id,
            email: (customer ? customer.email?.trim().toLowerCase() : user.email) ?? '',
            phone: user.phone ?? '',
            firstName: customer ? customer.firstName : user.firstName,
            lastName: (customer ? customer.lastName : user.lastName) ?? '',
            addressLine1: customer?.addressLine1 ?? '',
            addressLine2: customer?.addressLine2 ?? '',
            city: customer?.city ?? '',
            state: customer?.state ?? '',
            pincode: customer?.pincode ?? '',
            country: 'India',
            deliveryMethod: 'standard',
            deliveryFee: 0,
            subtotal,
            total: input.total, // the handwritten bill's stated total wins
            status: input.initialStatus ?? 'in_atelier',
            channel: input.channel,
            billType: input.billType,
            billNumber: input.billNumber ?? null,
            gstAmount: input.gstAmount ?? null,
            deliveryDueDate: input.deliveryDueDate ?? null,
            notes: input.notes ?? '',
          },
          input.items.map((it) => {
            const v = it.variantId ? lockedVariants.get(it.variantId) : undefined;
            return {
              productName: it.description,
              unitPrice: it.unitPrice, // the handwritten bill's price wins
              quantity: it.quantity,
              productId: v?.productId ?? null,
              variantId: v?.id ?? null,
              size: v?.size ?? '',
              color: v?.color ?? '',
              imageUrl: v?.imageUrl ?? null,
            };
          }),
        );

        for (const [id, qty] of linkedQuantities) {
          await deps.products.decrementStock(tx, id, qty);
        }

        // Attach the scanned photos + save reviewed measurements in the SAME
        // transaction — a failed order must leave no confirmed documents behind.
        if (input.documentIds?.length) {
          await deps.documents.setStatusAndOrder(input.documentIds, 'confirmed', order.id, tx);
        }
        for (const set of input.measurementSets ?? []) {
          await deps.measurements.create(
            {
              userId: user.id,
              orderId: order.id,
              documentId: set.documentId ?? null,
              label: set.label,
              data: set.data,
              notes: set.notes,
            },
            tx,
          );
        }

        if (!input.advance) return order;
        await deps.receipts.create(
          { orderId: order.id, amount: input.advance.amount, mode: input.advance.mode },
          tx,
        );
        return (await deps.orders.getById(order.id, tx))!;
      });
    },

    async getOrderForRequester(orderNumber, requester) {
      const order = await deps.orders.getByNumber(orderNumber);
      // A non-matching requester gets the same 404 as a missing order — no leaking.
      if (!order || !requesterOwnsOrder(order, requester)) {
        throw new DomainError('NOT_FOUND', 'Order not found');
      }
      return order;
    },

    listUserOrders(userId) {
      return deps.orders.listByUser(userId);
    },

    async cancelOrder(orderId) {
      return deps.runInTransaction(async (tx) => {
        const order = await deps.orders.getById(orderId, tx);
        if (!order) throw new DomainError('NOT_FOUND', 'Order not found');
        const offline = order.channel !== 'online';
        const cancellable = offline ? OFFLINE_CANCELLABLE : CANCELLABLE;
        if (!cancellable.includes(order.status)) {
          throw new DomainError('INVALID_STATUS_TRANSITION', `Cannot cancel an order in status '${order.status}'`);
        }
        // Any line that decremented stock gets it back: online lines always,
        // offline lines only when linked to the catalogue (freeform lines and
        // orders created before linking existed carry a null variantId).
        for (const item of order.items) {
          if (item.variantId) await deps.products.restock(tx, item.variantId, item.quantity);
        }
        return (await deps.orders.updateStatus(orderId, 'cancelled', tx))!;
      });
    },

    async updateStatus(orderId, next) {
      if (next === 'cancelled') return service.cancelOrder(orderId); // cancelling restocks (online only)
      const order = await deps.orders.getById(orderId);
      if (!order) throw new DomainError('NOT_FOUND', 'Order not found');
      if (!TRANSITIONS[order.status].includes(next)) {
        throw new DomainError('INVALID_STATUS_TRANSITION', `Cannot move order from '${order.status}' to '${next}'`);
      }
      return (await deps.orders.updateStatus(orderId, next))!;
    },

    async recordReceipt(orderId, input) {
      const order = await deps.orders.getById(orderId);
      if (!order) throw new DomainError('NOT_FOUND', 'Order not found');
      if (order.status === 'cancelled') {
        throw new DomainError('ORDER_CANCELLED', 'This order is cancelled — payments can no longer be recorded against it');
      }
      if (order.advancePaid + input.amount > order.total) {
        throw new DomainError('OVER_COLLECTION', 'Payment would exceed the order total');
      }
      await deps.receipts.create({ orderId, ...input });
      return (await deps.orders.getById(orderId))!;
    },

    async updateOrderDetails(orderId, patch) {
      // A patch may change the bill type and number independently — the pair
      // that would result must never be a GST invoice with a blank number.
      if (patch.billNumber !== undefined || patch.billType !== undefined) {
        const current = await deps.orders.getById(orderId);
        if (!current) throw new DomainError('NOT_FOUND', 'Order not found');
        const billType = patch.billType === undefined ? current.billType : patch.billType;
        const billNumber = patch.billNumber === undefined ? current.billNumber : patch.billNumber;
        if (billType === 'gst_invoice' && !billNumber?.trim()) {
          throw new DomainError('BILL_NUMBER_REQUIRED', 'A GST invoice needs a bill number');
        }
      }
      const order = await deps.orders.updateDetails(orderId, patch);
      if (!order) throw new DomainError('NOT_FOUND', 'Order not found');
      return order;
    },
  };
  return service;
}
