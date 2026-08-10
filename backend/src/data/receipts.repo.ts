import { Pool, PoolClient } from 'pg';
import { Receipt, ReceiptMode, Tx } from '../types';

export interface CreateReceiptInput {
  orderId: string;
  amount: number;
  mode: ReceiptMode;
  /** YYYY-MM-DD; defaults to today. */
  receivedAt?: string;
  note?: string;
}

export interface ReceiptsRepo {
  create(input: CreateReceiptInput, tx?: Tx): Promise<Receipt>;
  listByOrder(orderId: string): Promise<Receipt[]>;
  sumByOrder(orderId: string): Promise<number>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mapReceipt(row: any): Receipt {
  return {
    id: row.id,
    orderId: row.order_id,
    amount: row.amount,
    mode: row.mode,
    receivedAt: row.received_at,
    note: row.note,
    createdAt: row.created_at.toISOString(),
  };
}

const COLUMNS = 'id, order_id, amount, mode, received_at::text AS received_at, note, created_at';

export function createReceiptsRepo(pool: Pool): ReceiptsRepo {
  return {
    async create({ orderId, amount, mode, receivedAt, note }, tx) {
      const client = (tx as PoolClient) ?? pool;
      const { rows } = await client.query(
        // The default is today's date IN IST, not the DB server's (UTC) day —
        // a payment taken before 05:30 IST used to be stamped yesterday.
        `INSERT INTO order_receipts (order_id, amount, mode, received_at, note)
         VALUES ($1, $2, $3, COALESCE($4::date, (now() AT TIME ZONE 'Asia/Kolkata')::date), $5)
         RETURNING ${COLUMNS}`,
        [orderId, amount, mode, receivedAt ?? null, note ?? ''],
      );
      return mapReceipt(rows[0]);
    },

    async listByOrder(orderId) {
      if (!UUID_RE.test(orderId)) return [];
      const { rows } = await pool.query(
        `SELECT ${COLUMNS} FROM order_receipts WHERE order_id = $1 ORDER BY received_at, created_at`,
        [orderId],
      );
      return rows.map(mapReceipt);
    },

    async sumByOrder(orderId) {
      if (!UUID_RE.test(orderId)) return 0;
      const { rows } = await pool.query(
        'SELECT COALESCE(SUM(amount), 0)::int AS total FROM order_receipts WHERE order_id = $1',
        [orderId],
      );
      return rows[0].total;
    },
  };
}
