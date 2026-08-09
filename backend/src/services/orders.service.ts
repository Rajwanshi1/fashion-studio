import type { DocumentsRepo } from '../data/documents.repo';
import type { MeasurementsRepo } from '../data/measurements.repo';
import type { OrderDetailsPatch, OrdersRepo } from '../data/orders.repo';
import type { ProductsRepo } from '../data/products.repo';
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
    /** Set pieces are included unless explicitly opted out. */
    includeDupatta?: boolean;
    includeJacket?: boolean;
  }[];
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
  items: { description: string; quantity: number; unitPrice: number }[];
  gstAmount?: number;
  /** Paise — the stated total wins (handwritten bills rarely sum exactly). */
  total: number;
  /** Creates the initial receipt in the same transaction. */
  advance?: { amount: number; mode: ReceiptMode };
  deliveryDueDate?: string;
  notes?: string;
  /** Default in_atelier; delivered = exhibition spot sale. */
  initialStatus?: 'in_atelier' | 'delivered';
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

    async createOfflineOrder(input) {
      if (input.items.length === 0) {
        throw new DomainError('EMPTY_ORDER', 'Order must contain at least one item');
      }
      const subtotal = input.items.reduce((sum, it) => sum + it.unitPrice * it.quantity, 0);
      if (input.advance && input.advance.amount > input.total) {
        throw new DomainError('OVER_COLLECTION', 'Advance cannot exceed the order total');
      }

      return deps.runInTransaction(async (tx) => {
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
          input.items.map((it) => ({
            productName: it.description,
            unitPrice: it.unitPrice,
            quantity: it.quantity,
          })),
        );

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
        if (!offline) {
          // Offline lines never held stock; online freeform lines (none today) are skipped too.
          for (const item of order.items) {
            if (item.variantId) await deps.products.restock(tx, item.variantId, item.quantity);
          }
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
      const order = await deps.orders.updateDetails(orderId, patch);
      if (!order) throw new DomainError('NOT_FOUND', 'Order not found');
      return order;
    },
  };
  return service;
}
