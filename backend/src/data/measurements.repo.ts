import { Pool } from 'pg';

export interface MeasurementRow {
  id: string;
  userId: string;
  orderId: string | null;
  documentId: string | null;
  label: string;
  /** Free-form measurement JSON (names/values verbatim from the page). */
  data: object;
  notes: string;
  createdAt: string;
}

export interface CreateMeasurementInput {
  userId: string;
  orderId?: string | null;
  documentId?: string | null;
  label?: string;
  data: object;
  notes?: string;
}

export interface MeasurementsRepo {
  create(input: CreateMeasurementInput): Promise<MeasurementRow>;
  listByUser(userId: string): Promise<MeasurementRow[]>;
  listByOrder(orderId: string): Promise<MeasurementRow[]>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapRow(row: any): MeasurementRow {
  return {
    id: row.id,
    userId: row.user_id,
    orderId: row.order_id ?? null,
    documentId: row.document_id ?? null,
    label: row.label,
    data: row.data,
    notes: row.notes,
    createdAt: row.created_at.toISOString(),
  };
}

export function createMeasurementsRepo(pool: Pool): MeasurementsRepo {
  return {
    async create(input) {
      const { rows } = await pool.query(
        `INSERT INTO measurements (user_id, order_id, document_id, label, data, notes)
         VALUES ($1, $2, $3, $4, $5, $6) RETURNING *`,
        [
          input.userId,
          input.orderId ?? null,
          input.documentId ?? null,
          input.label ?? '',
          JSON.stringify(input.data),
          input.notes ?? '',
        ],
      );
      return mapRow(rows[0]);
    },

    async listByUser(userId) {
      if (!UUID_RE.test(userId)) return [];
      const { rows } = await pool.query(
        'SELECT * FROM measurements WHERE user_id = $1 ORDER BY created_at DESC',
        [userId],
      );
      return rows.map(mapRow);
    },

    async listByOrder(orderId) {
      if (!UUID_RE.test(orderId)) return [];
      const { rows } = await pool.query(
        'SELECT * FROM measurements WHERE order_id = $1 ORDER BY created_at DESC',
        [orderId],
      );
      return rows.map(mapRow);
    },
  };
}
