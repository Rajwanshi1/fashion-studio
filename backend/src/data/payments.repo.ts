import { Pool } from 'pg';
import { Payment, PaymentStatus } from '../types';

export interface CreatePaymentInput {
  orderId: string;
  provider: string;
  providerOrderId: string;
  amount: number;
  currency: string;
  status: PaymentStatus;
  method: string;
}

/**
 * One row of "money in", whatever the source: a gateway payment or a manual
 * receipt recorded at the counter. The Ledger page shows both — a boutique
 * taking most payments in cash cannot reconcile against gateway rows alone.
 */
export interface LedgerEntry {
  id: string;
  source: 'gateway' | 'manual';
  orderId: string;
  orderNumber: string;
  amount: number;
  /** Gateway method, or 'cash' | 'online' for manual receipts. */
  mode: string;
  status: PaymentStatus | 'received';
  /** Business date (IST), YYYY-MM-DD. */
  date: string;
  provider: string | null;
  providerOrderId: string | null;
  providerPaymentId: string | null;
  note: string;
}

export interface PaymentsRepo {
  create(input: CreatePaymentInput): Promise<Payment>;
  getById(id: string): Promise<Payment | null>;
  updateStatus(id: string, status: PaymentStatus, providerPaymentId?: string): Promise<Payment | null>;
  listLedger(): Promise<LedgerEntry[]>;
  getByOrderId(orderId: string): Promise<Payment[]>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapPayment(row: any): Payment {
  return {
    id: row.id,
    orderId: row.order_id,
    provider: row.provider,
    providerOrderId: row.provider_order_id,
    providerPaymentId: row.provider_payment_id ?? null,
    amount: row.amount,
    currency: row.currency,
    status: row.status,
    method: row.method,
    createdAt: row.created_at.toISOString(),
  };
}

export function createPaymentsRepo(pool: Pool): PaymentsRepo {
  return {
    async create(input) {
      const { rows } = await pool.query(
        `INSERT INTO payments (order_id, provider, provider_order_id, amount, currency, status, method)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [
          input.orderId,
          input.provider,
          input.providerOrderId,
          input.amount,
          input.currency,
          input.status,
          input.method,
        ],
      );
      return mapPayment(rows[0]);
    },

    async getById(id) {
      if (!UUID_RE.test(id)) return null;
      const { rows } = await pool.query('SELECT * FROM payments WHERE id = $1', [id]);
      return rows[0] ? mapPayment(rows[0]) : null;
    },

    async updateStatus(id, status, providerPaymentId) {
      if (!UUID_RE.test(id)) return null;
      const { rows } = await pool.query(
        `UPDATE payments
         SET status = $2, provider_payment_id = COALESCE($3, provider_payment_id), updated_at = now()
         WHERE id = $1 RETURNING *`,
        [id, status, providerPaymentId ?? null],
      );
      return rows[0] ? mapPayment(rows[0]) : null;
    },

    async listLedger() {
      // Column-aligned UNION of gateway payments and manual receipts.
      // Dates are business dates in IST: received_at already is one, and a
      // gateway timestamp is converted before the day is taken — otherwise a
      // payment taken before 05:30 IST lands on the previous day.
      const { rows } = await pool.query(
        `SELECT pay.id, 'gateway' AS source, pay.order_id, o.order_number,
                pay.amount, pay.method::text AS mode, pay.status::text AS status,
                to_char(pay.created_at AT TIME ZONE 'Asia/Kolkata', 'YYYY-MM-DD') AS date,
                pay.created_at AS sort_key,
                pay.provider, pay.provider_order_id, pay.provider_payment_id, '' AS note
           FROM payments pay JOIN orders o ON o.id = pay.order_id
         UNION ALL
         SELECT r.id, 'manual', r.order_id, o.order_number,
                r.amount, r.mode::text, 'received',
                r.received_at::text, r.created_at,
                NULL, NULL, NULL, COALESCE(r.note, '')
           FROM order_receipts r JOIN orders o ON o.id = r.order_id
         ORDER BY date DESC, sort_key DESC`,
      );
      return rows.map((row) => ({
        id: row.id,
        source: row.source,
        orderId: row.order_id,
        orderNumber: row.order_number,
        amount: row.amount,
        mode: row.mode,
        status: row.status,
        date: row.date,
        provider: row.provider,
        providerOrderId: row.provider_order_id,
        providerPaymentId: row.provider_payment_id,
        note: row.note,
      }));
    },

    async getByOrderId(orderId) {
      if (!UUID_RE.test(orderId)) return [];
      const { rows } = await pool.query(
        'SELECT * FROM payments WHERE order_id = $1 ORDER BY created_at ASC',
        [orderId],
      );
      return rows.map(mapPayment);
    },
  };
}
