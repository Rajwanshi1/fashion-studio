import { Pool, PoolClient } from 'pg';
import { mapReceipt } from './receipts.repo';
import { BillType, DeliveryMethod, Order, OrderChannel, OrderItem, OrderStatus, Receipt, Tx } from '../types';

export interface NewOrder {
  orderNumber: string;
  userId: string | null;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  deliveryMethod: DeliveryMethod;
  deliveryFee: number;
  subtotal: number;
  total: number;
  status: OrderStatus;
}

export interface NewOrderItem {
  productId: string;
  variantId: string;
  productName: string;
  size: string;
  color: string;
  /** Final per-unit price: base garment + chosen add-ons. */
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
  /** Kept optional add-ons snapshotted at order time; price paise. */
  components: { name: string; price: number }[];
  /** Free-text made-to-measure note; optional so offline call sites are untouched. */
  measurements?: string;
}

/** Offline order: bill metadata on top of NewOrder. */
export interface NewOfflineOrder extends NewOrder {
  channel: Exclude<OrderChannel, 'online'>;
  billType: BillType;
  billNumber: string | null;
  gstAmount: number | null;
  deliveryDueDate: string | null;
  notes: string;
}

/** Handwritten-bill line — freeform by default, optionally linked to a variant. */
export interface NewOfflineItem {
  productName: string;
  unitPrice: number;
  quantity: number;
  productId?: string | null;
  variantId?: string | null;
  /** Snapshot fields, filled from the variant when linked. */
  size?: string;
  color?: string;
  imageUrl?: string | null;
}

export interface OrderDetailsPatch {
  deliveryDueDate?: string | null;
  billNumber?: string | null;
  billType?: BillType | null;
  gstAmount?: number | null;
  carrier?: string | null;
  awb?: string | null;
  notes?: string;
}

export interface AdminOrdersFilter {
  status?: OrderStatus;
  channel?: OrderChannel;
  billType?: BillType;
}

export interface OrdersRepo {
  createWithItems(tx: Tx, order: NewOrder, items: NewOrderItem[]): Promise<Order>;
  createOffline(tx: Tx, order: NewOfflineOrder, items: NewOfflineItem[]): Promise<Order>;
  getByNumber(orderNumber: string): Promise<Order | null>;
  getById(id: string, tx?: Tx): Promise<Order | null>;
  listByUser(userId: string): Promise<Order[]>;
  /** Open orders with a promised date, soonest first — the delivery board. */
  listDeliveries(): Promise<Order[]>;
  /** Live orders with NO due date — work that can silently fall off the board. */
  listUnscheduled(): Promise<Order[]>;
  listAdmin(filter?: AdminOrdersFilter): Promise<Order[]>;
  updateStatus(id: string, status: OrderStatus, tx?: Tx): Promise<Order | null>;
  updateDetails(id: string, patch: OrderDetailsPatch): Promise<Order | null>;
  /** Stamps invoice_sent_at = now(); returns the fresh order (null when missing). */
  markInvoiceSent(id: string): Promise<Order | null>;
  nextOrderNumber(tx: Tx): Promise<string>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapItem(row: any): OrderItem {
  return {
    id: row.id,
    productId: row.product_id ?? null,
    variantId: row.variant_id ?? null,
    productName: row.product_name,
    size: row.size,
    color: row.color,
    unitPrice: row.unit_price,
    quantity: row.quantity,
    imageUrl: row.image_url ?? null,
    components: row.components ?? [],
    measurements: row.measurements ?? '',
  };
}

/** pg parses `date` columns to a local-midnight Date; keep the calendar day. */
function toDateStr(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) {
    const pad = (n: number) => String(n).padStart(2, '0');
    return `${value.getFullYear()}-${pad(value.getMonth() + 1)}-${pad(value.getDate())}`;
  }
  return String(value).slice(0, 10);
}

function mapOrder(row: any, items: OrderItem[], receipts: Receipt[]): Order {
  const advancePaid = receipts.reduce((sum, r) => sum + r.amount, 0);
  return {
    id: row.id,
    orderNumber: row.order_number,
    userId: row.user_id ?? null,
    email: row.email,
    phone: row.phone,
    firstName: row.first_name,
    lastName: row.last_name,
    addressLine1: row.address_line1,
    addressLine2: row.address_line2,
    city: row.city,
    state: row.state,
    pincode: row.pincode,
    country: row.country,
    deliveryMethod: row.delivery_method,
    deliveryFee: row.delivery_fee,
    subtotal: row.subtotal,
    total: row.total,
    status: row.status,
    channel: row.channel,
    billType: row.bill_type ?? null,
    billNumber: row.bill_number ?? null,
    gstAmount: row.gst_amount ?? null,
    deliveryDueDate: toDateStr(row.delivery_due_date),
    carrier: row.carrier ?? null,
    awb: row.awb ?? null,
    notes: row.notes,
    invoiceSentAt: row.invoice_sent_at ? row.invoice_sent_at.toISOString() : null,
    advancePaid,
    balance: row.total - advancePaid,
    receipts,
    createdAt: row.created_at.toISOString(),
    items,
  };
}

export function createOrdersRepo(pool: Pool): OrdersRepo {
  async function loadItems(client: Pool | PoolClient, orderIds: string[]): Promise<Map<string, OrderItem[]>> {
    const byOrder = new Map<string, OrderItem[]>();
    if (orderIds.length === 0) return byOrder;
    const { rows } = await client.query(
      'SELECT * FROM order_items WHERE order_id = ANY($1::uuid[]) ORDER BY product_name, size',
      [orderIds],
    );
    for (const row of rows) {
      const list = byOrder.get(row.order_id) ?? [];
      list.push(mapItem(row));
      byOrder.set(row.order_id, list);
    }
    return byOrder;
  }

  async function loadReceipts(client: Pool | PoolClient, orderIds: string[]): Promise<Map<string, Receipt[]>> {
    const byOrder = new Map<string, Receipt[]>();
    if (orderIds.length === 0) return byOrder;
    const { rows } = await client.query(
      `SELECT id, order_id, amount, mode, received_at::text AS received_at, note, created_at
       FROM order_receipts WHERE order_id = ANY($1::uuid[]) ORDER BY received_at, created_at`,
      [orderIds],
    );
    for (const row of rows) {
      const list = byOrder.get(row.order_id) ?? [];
      list.push(mapReceipt(row));
      byOrder.set(row.order_id, list);
    }
    return byOrder;
  }

  async function loadOrders(client: Pool | PoolClient, whereSql: string, params: unknown[]): Promise<Order[]> {
    const { rows } = await client.query(`SELECT * FROM orders ${whereSql}`, params);
    const ids = rows.map((r) => r.id);
    const [items, receipts] = await Promise.all([loadItems(client, ids), loadReceipts(client, ids)]);
    return rows.map((row) => mapOrder(row, items.get(row.id) ?? [], receipts.get(row.id) ?? []));
  }

  async function loadOne(client: Pool | PoolClient, id: string): Promise<Order | null> {
    const orders = await loadOrders(client, 'WHERE id = $1', [id]);
    return orders[0] ?? null;
  }

  return {
    async createWithItems(tx, order, items) {
      const client = tx as PoolClient;
      const { rows } = await client.query(
        `INSERT INTO orders (order_number, user_id, email, phone, first_name, last_name,
                             address_line1, address_line2, city, state, pincode, country,
                             delivery_method, delivery_fee, subtotal, total, status)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17)
         RETURNING *`,
        [
          order.orderNumber,
          order.userId,
          order.email,
          order.phone,
          order.firstName,
          order.lastName,
          order.addressLine1,
          order.addressLine2,
          order.city,
          order.state,
          order.pincode,
          order.country,
          order.deliveryMethod,
          order.deliveryFee,
          order.subtotal,
          order.total,
          order.status,
        ],
      );
      const orderRow = rows[0];
      const created: OrderItem[] = [];
      for (const item of items) {
        const { rows: itemRows } = await client.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, product_name, size, color,
                                    unit_price, quantity, image_url, components, measurements)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11) RETURNING *`,
          [
            orderRow.id,
            item.productId,
            item.variantId,
            item.productName,
            item.size,
            item.color,
            item.unitPrice,
            item.quantity,
            item.imageUrl,
            JSON.stringify(item.components),
            item.measurements ?? '',
          ],
        );
        created.push(mapItem(itemRows[0]));
      }
      return mapOrder(orderRow, created, []);
    },

    async createOffline(tx, order, items) {
      const client = tx as PoolClient;
      const { rows } = await client.query(
        `INSERT INTO orders (order_number, user_id, email, phone, first_name, last_name,
                             address_line1, address_line2, city, state, pincode, country,
                             delivery_method, delivery_fee, subtotal, total, status,
                             channel, bill_type, bill_number, gst_amount, delivery_due_date, notes)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19,$20,$21,$22,$23)
         RETURNING *`,
        [
          order.orderNumber,
          order.userId,
          order.email,
          order.phone,
          order.firstName,
          order.lastName,
          order.addressLine1,
          order.addressLine2,
          order.city,
          order.state,
          order.pincode,
          order.country,
          order.deliveryMethod,
          order.deliveryFee,
          order.subtotal,
          order.total,
          order.status,
          order.channel,
          order.billType,
          order.billNumber,
          order.gstAmount,
          order.deliveryDueDate,
          order.notes,
        ],
      );
      const orderRow = rows[0];
      const created: OrderItem[] = [];
      for (const item of items) {
        const { rows: itemRows } = await client.query(
          `INSERT INTO order_items (order_id, product_id, variant_id, product_name, size, color,
                                    unit_price, quantity, image_url)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9) RETURNING *`,
          [
            orderRow.id,
            item.productId ?? null,
            item.variantId ?? null,
            item.productName,
            item.size ?? '',
            item.color ?? '',
            item.unitPrice,
            item.quantity,
            item.imageUrl ?? null,
          ],
        );
        created.push(mapItem(itemRows[0]));
      }
      return mapOrder(orderRow, created, []);
    },

    async getByNumber(orderNumber) {
      const orders = await loadOrders(pool, 'WHERE order_number = $1', [orderNumber]);
      return orders[0] ?? null;
    },

    async getById(id, tx) {
      if (!UUID_RE.test(id)) return null;
      return loadOne((tx as PoolClient) ?? pool, id);
    },

    async listDeliveries() {
      return loadOrders(
        pool,
        `WHERE status NOT IN ('delivered','cancelled') AND delivery_due_date IS NOT NULL
         ORDER BY delivery_due_date ASC, created_at ASC`,
        [],
      );
    },

    async listUnscheduled() {
      // Offline orders only: every abandoned online checkout sits forever at
      // pending_payment with no due date and would flood the board otherwise.
      return loadOrders(
        pool,
        `WHERE channel <> 'online' AND status NOT IN ('delivered','cancelled')
           AND delivery_due_date IS NULL
         ORDER BY created_at ASC`,
        [],
      );
    },

    async listByUser(userId) {
      if (!UUID_RE.test(userId)) return [];
      return loadOrders(pool, 'WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    },

    async listAdmin(filter = {}) {
      const where: string[] = [];
      const params: unknown[] = [];
      if (filter.status) {
        params.push(filter.status);
        where.push(`status = $${params.length}`);
      }
      if (filter.channel) {
        params.push(filter.channel);
        where.push(`channel = $${params.length}`);
      }
      if (filter.billType) {
        params.push(filter.billType);
        where.push(`bill_type = $${params.length}`);
      }
      const whereSql = where.length ? `WHERE ${where.join(' AND ')} ` : '';
      return loadOrders(pool, `${whereSql}ORDER BY created_at DESC`, params);
    },

    async updateStatus(id, status, tx) {
      if (!UUID_RE.test(id)) return null;
      const client = (tx as PoolClient) ?? pool;
      const { rows } = await client.query(
        'UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING id',
        [id, status],
      );
      if (!rows[0]) return null;
      return loadOne(client, id);
    },

    async updateDetails(id, patch) {
      if (!UUID_RE.test(id)) return null;
      const sets: string[] = [];
      const params: unknown[] = [id];
      const push = (column: string, value: unknown) => {
        params.push(value);
        sets.push(`${column} = $${params.length}`);
      };
      if (patch.deliveryDueDate !== undefined) push('delivery_due_date', patch.deliveryDueDate);
      if (patch.billNumber !== undefined) push('bill_number', patch.billNumber);
      if (patch.billType !== undefined) push('bill_type', patch.billType);
      if (patch.gstAmount !== undefined) push('gst_amount', patch.gstAmount);
      if (patch.carrier !== undefined) push('carrier', patch.carrier);
      if (patch.awb !== undefined) push('awb', patch.awb);
      if (patch.notes !== undefined) push('notes', patch.notes);
      if (sets.length === 0) return loadOne(pool, id);
      const { rows } = await pool.query(
        `UPDATE orders SET ${sets.join(', ')}, updated_at = now() WHERE id = $1 RETURNING id`,
        params,
      );
      if (!rows[0]) return null;
      return loadOne(pool, id);
    },

    async markInvoiceSent(id) {
      if (!UUID_RE.test(id)) return null;
      const { rows } = await pool.query(
        'UPDATE orders SET invoice_sent_at = now(), updated_at = now() WHERE id = $1 RETURNING id',
        [id],
      );
      if (!rows[0]) return null;
      return loadOne(pool, id);
    },

    async nextOrderNumber(tx) {
      const { rows } = await (tx as PoolClient).query("SELECT nextval('order_number_seq')::int AS n");
      return `TA-2026-${String(rows[0].n).padStart(5, '0')}`;
    },
  };
}
