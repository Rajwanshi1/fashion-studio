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

/** Admin listing includes the human-facing order number. */
export interface AdminPayment extends Payment {
  orderNumber: string;
}

export interface PaymentsRepo {
  create(input: CreatePaymentInput): Promise<Payment>;
  getById(id: string): Promise<Payment | null>;
  updateStatus(id: string, status: PaymentStatus, providerPaymentId?: string): Promise<Payment | null>;
  listAdmin(): Promise<AdminPayment[]>;
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

    async listAdmin() {
      const { rows } = await pool.query(
        `SELECT pay.*, o.order_number FROM payments pay
         JOIN orders o ON o.id = pay.order_id
         ORDER BY pay.created_at DESC`,
      );
      return rows.map((row) => ({ ...mapPayment(row), orderNumber: row.order_number }));
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
