import { Pool, PoolClient } from 'pg';
import { DeliveryMethod, Order, OrderItem, OrderStatus, Tx } from '../types';

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
  /** Chosen add-on price snapshot; null = excluded or not part of the set. */
  dupattaPrice: number | null;
  jacketPrice: number | null;
}

export interface OrdersRepo {
  createWithItems(tx: Tx, order: NewOrder, items: NewOrderItem[]): Promise<Order>;
  getByNumber(orderNumber: string): Promise<Order | null>;
  getById(id: string, tx?: Tx): Promise<Order | null>;
  listByUser(userId: string): Promise<Order[]>;
  listAdmin(status?: OrderStatus): Promise<Order[]>;
  updateStatus(id: string, status: OrderStatus, tx?: Tx): Promise<Order | null>;
  nextOrderNumber(tx: Tx): Promise<string>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapItem(row: any): OrderItem {
  return {
    id: row.id,
    productId: row.product_id,
    variantId: row.variant_id,
    productName: row.product_name,
    size: row.size,
    color: row.color,
    unitPrice: row.unit_price,
    quantity: row.quantity,
    imageUrl: row.image_url ?? null,
    dupattaPrice: row.dupatta_price ?? null,
    jacketPrice: row.jacket_price ?? null,
  };
}

function mapOrder(row: any, items: OrderItem[]): Order {
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

  async function loadOrders(client: Pool | PoolClient, whereSql: string, params: unknown[]): Promise<Order[]> {
    const { rows } = await client.query(`SELECT * FROM orders ${whereSql}`, params);
    const items = await loadItems(client, rows.map((r) => r.id));
    return rows.map((row) => mapOrder(row, items.get(row.id) ?? []));
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
                                    unit_price, quantity, image_url, dupatta_price, jacket_price)
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
            item.dupattaPrice,
            item.jacketPrice,
          ],
        );
        created.push(mapItem(itemRows[0]));
      }
      return mapOrder(orderRow, created);
    },

    async getByNumber(orderNumber) {
      const orders = await loadOrders(pool, 'WHERE order_number = $1', [orderNumber]);
      return orders[0] ?? null;
    },

    async getById(id, tx) {
      if (!UUID_RE.test(id)) return null;
      const orders = await loadOrders((tx as PoolClient) ?? pool, 'WHERE id = $1', [id]);
      return orders[0] ?? null;
    },

    async listByUser(userId) {
      if (!UUID_RE.test(userId)) return [];
      return loadOrders(pool, 'WHERE user_id = $1 ORDER BY created_at DESC', [userId]);
    },

    async listAdmin(status) {
      if (status) return loadOrders(pool, 'WHERE status = $1 ORDER BY created_at DESC', [status]);
      return loadOrders(pool, 'ORDER BY created_at DESC', []);
    },

    async updateStatus(id, status, tx) {
      if (!UUID_RE.test(id)) return null;
      const client = (tx as PoolClient) ?? pool;
      const { rows } = await client.query(
        'UPDATE orders SET status = $2, updated_at = now() WHERE id = $1 RETURNING *',
        [id, status],
      );
      if (!rows[0]) return null;
      const items = await loadItems(client, [id]);
      return mapOrder(rows[0], items.get(id) ?? []);
    },

    async nextOrderNumber(tx) {
      const { rows } = await (tx as PoolClient).query("SELECT nextval('order_number_seq')::int AS n");
      return `TA-2026-${String(rows[0].n).padStart(5, '0')}`;
    },
  };
}
