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
  items: { variantId: string; quantity: number }[];
}

export interface OrdersService {
  createOrder(input: CreateOrderInput): Promise<Order>;
  getOrderForRequester(
    orderNumber: string,
    requester: { userId?: string | null; email?: string | null },
  ): Promise<Order>;
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
      // Merge duplicate variant lines so stock is checked once per variant.
      const quantities = new Map<string, number>();
      for (const item of input.items ?? []) {
        quantities.set(item.variantId, (quantities.get(item.variantId) ?? 0) + item.quantity);
      }
      if (quantities.size === 0) {
        throw new DomainError('EMPTY_ORDER', 'Order must contain at least one item');
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

        // Prices always come from the DB, never the client.
        const items = variantIds.map((id) => {
          const v = byId.get(id)!;
          return {
            productId: v.productId,
            variantId: v.id,
            productName: v.productName,
            size: v.size,
            color: v.color,
            unitPrice: v.unitPrice,
            quantity: quantities.get(id)!,
            imageUrl: v.imageUrl,
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
      const matchesUser = !!requester.userId && order?.userId === requester.userId;
      const matchesEmail =
        !!requester.email && order?.email.toLowerCase() === requester.email.trim().toLowerCase();
      // A non-matching requester gets the same 404 as a missing order — no leaking.
      if (!order || (!matchesUser && !matchesEmail)) {
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
