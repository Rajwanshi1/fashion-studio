import { Pool, PoolClient } from 'pg';
import { Tx } from '../types';

export type DocumentKind = 'bill' | 'measurement' | 'shipping_receipt';

export type DocumentStatus = 'uploaded' | 'parsed' | 'confirmed' | 'discarded';

export interface DocumentRow {
  id: string;
  storageKey: string;
  kind: DocumentKind;
  contentType: string;
  orderId: string | null;
  uploadedBy: string | null;
  /** Claude draft JSON, null until parsed. */
  parse: unknown;
  status: DocumentStatus;
  createdAt: string;
}

export interface CreateDocumentInput {
  storageKey: string;
  kind: DocumentKind;
  contentType: string;
  uploadedBy: string | null;
}

export interface DocumentsRepo {
  create(input: CreateDocumentInput): Promise<DocumentRow>;
  getById(id: string): Promise<DocumentRow | null>;
  setParse(id: string, parse: unknown, status: DocumentStatus): Promise<DocumentRow | null>;
  /** Batch update — used at offline-order confirm to link + confirm in one go. */
  setStatusAndOrder(ids: string[], status: DocumentStatus, orderId: string, tx?: Tx): Promise<void>;
  listByOrder(orderId: string): Promise<DocumentRow[]>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapRow(row: any): DocumentRow {
  return {
    id: row.id,
    storageKey: row.storage_key,
    kind: row.kind,
    contentType: row.content_type,
    orderId: row.order_id ?? null,
    uploadedBy: row.uploaded_by ?? null,
    parse: row.parse ?? null,
    status: row.status,
    createdAt: row.created_at.toISOString(),
  };
}

export function createDocumentsRepo(pool: Pool): DocumentsRepo {
  return {
    async create(input) {
      const { rows } = await pool.query(
        `INSERT INTO documents (storage_key, kind, content_type, uploaded_by)
         VALUES ($1, $2, $3, $4) RETURNING *`,
        [input.storageKey, input.kind, input.contentType, input.uploadedBy],
      );
      return mapRow(rows[0]);
    },

    async getById(id) {
      if (!UUID_RE.test(id)) return null;
      const { rows } = await pool.query('SELECT * FROM documents WHERE id = $1', [id]);
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async setParse(id, parse, status) {
      if (!UUID_RE.test(id)) return null;
      const { rows } = await pool.query(
        'UPDATE documents SET parse = $2, status = $3 WHERE id = $1 RETURNING *',
        [id, JSON.stringify(parse), status],
      );
      return rows[0] ? mapRow(rows[0]) : null;
    },

    async setStatusAndOrder(ids, status, orderId, tx) {
      const valid = ids.filter((id) => UUID_RE.test(id));
      if (valid.length === 0) return;
      const client = (tx as PoolClient) ?? pool;
      await client.query(
        'UPDATE documents SET status = $2, order_id = $3 WHERE id = ANY($1::uuid[])',
        [valid, status, orderId],
      );
    },

    async listByOrder(orderId) {
      if (!UUID_RE.test(orderId)) return [];
      const { rows } = await pool.query(
        'SELECT * FROM documents WHERE order_id = $1 ORDER BY created_at',
        [orderId],
      );
      return rows.map(mapRow);
    },
  };
}
