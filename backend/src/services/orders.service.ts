import type { OrdersRepo } from '../data/orders.repo';
import type { ProductsRepo } from '../data/products.repo';
import { DeliveryMethod, DomainError, Order, OrderStatus, TxRunner } from '../types';

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
    /** Set pieces are included unless explicitly opted out. */
    includeDupatta?: boolean;
    includeJacket?: boolean;
  }[];
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
  getOrderForRequester(orderNumber: string, requester: OrderRequester): Promise<Order>;
  listUserOrders(userId: string): Promise<Order[]>;
  cancelOrder(orderId: string): Promise<Order>;
  updateStatus(orderId: string, next: OrderStatus): Promise<Order>;
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

export function createOrdersService(deps: {
  products: ProductsRepo;
  orders: OrdersRepo;
  runInTransaction: TxRunner;
}): OrdersService {
  const service: OrdersService = {
    async createOrder(input) {
      // Merge duplicate lines per variant + set-includes combo: the same
      // variant with and without a dupatta is two distinct order lines.
      const combos = new Map<string, { variantId: string; dupatta: boolean; jacket: boolean; qty: number }>();
      for (const item of input.items ?? []) {
        const dupatta = item.includeDupatta !== false; // default: included
        const jacket = item.includeJacket !== false;
        const key = `${item.variantId}|${dupatta ? 1 : 0}${jacket ? 1 : 0}`;
        const existing = combos.get(key);
        if (existing) existing.qty += item.quantity;
        else combos.set(key, { variantId: item.variantId, dupatta, jacket, qty: item.quantity });
      }
      if (combos.size === 0) {
        throw new DomainError('EMPTY_ORDER', 'Order must contain at least one item');
      }
      // Stock is held per variant, so aggregate across combos for the check.
      const quantities = new Map<string, number>();
      for (const combo of combos.values()) {
        quantities.set(combo.variantId, (quantities.get(combo.variantId) ?? 0) + combo.qty);
      }

      return deps.runInTransaction(async (tx) => {
        const variantIds = [...quantities.keys()];
        const variants = await deps.products.getVariantsForUpdate(tx, variantIds);
        const byId = new Map(variants.map((v) => [v.id, v]));
        for (const id of variantIds) {
          if (!byId.has(id)) throw new DomainError('NOT_FOUND', 'One or more items are no longer available');
        }
        for (const [id, qty] of quantities) {
          const variant = byId.get(id)!;
          if (variant.stock < qty) {
            throw new DomainError('INSUFFICIENT_STOCK', `Insufficient stock for ${variant.productName} (${variant.size})`);
          }
        }

        // Prices always come from the DB, never the client. An opt-in only
        // counts when the product actually has that piece in its set.
        const items = [...combos.values()].map((combo) => {
          const v = byId.get(combo.variantId)!;
          const dupattaPrice = combo.dupatta && v.dupattaPrice != null ? v.dupattaPrice : null;
          const jacketPrice = combo.jacket && v.jacketPrice != null ? v.jacketPrice : null;
          return {
            productId: v.productId,
            variantId: v.id,
            productName: v.productName,
            size: v.size,
            color: v.color,
            unitPrice: v.unitPrice + (dupattaPrice ?? 0) + (jacketPrice ?? 0),
            quantity: combo.qty,
            imageUrl: v.imageUrl,
            dupattaPrice,
            jacketPrice,
          };
        });
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
        if (!CANCELLABLE.includes(order.status)) {
          throw new DomainError('INVALID_STATUS_TRANSITION', `Cannot cancel an order in status '${order.status}'`);
        }
        for (const item of order.items) {
          await deps.products.restock(tx, item.variantId, item.quantity);
        }
        return (await deps.orders.updateStatus(orderId, 'cancelled', tx))!;
      });
    },

    async updateStatus(orderId, next) {
      if (next === 'cancelled') return service.cancelOrder(orderId); // cancelling restocks
      const order = await deps.orders.getById(orderId);
      if (!order) throw new DomainError('NOT_FOUND', 'Order not found');
      if (!TRANSITIONS[order.status].includes(next)) {
        throw new DomainError('INVALID_STATUS_TRANSITION', `Cannot move order from '${order.status}' to '${next}'`);
      }
      return (await deps.orders.updateStatus(orderId, next))!;
    },
  };
  return service;
}
