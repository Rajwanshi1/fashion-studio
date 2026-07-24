// Shared upload/parse helpers for the bill-intake wizard and the orders page.
// The presign + parse + view-url calls go through the JSON api<T>() client; the
// actual photo bytes go via a RAW fetch PUT to the presigned URL (S3 in
// production, the dev-only /api/uploads/local transport otherwise).
import { api, storedToken } from './api';
import { prepareImage } from './image';
import type { DocumentKind } from './types';

export interface PresignResult {
  documentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

/** Mirrors backend/src/services/ai/prompts.ts billSchema — all rupees as written. */
export interface BillDraft {
  bill: {
    bill_number: string | null;
    bill_date: string | null;
    bill_type: 'gst_invoice' | 'cash_memo' | null;
    channel_guess: 'in_store' | 'instagram' | 'exhibition' | null;
  };
  customer: {
    name: string | null;
    phone: string | null;
    email: string | null;
    address: string | null;
    city: string | null;
    state: string | null;
    pincode: string | null;
  };
  items: {
    description: string;
    quantity: number | null;
    unit_price_rupees: number | null;
    line_total_rupees: number | null;
  }[];
  totals: {
    subtotal_rupees: number | null;
    gst_rupees: number | null;
    total_rupees: number | null;
    advance_rupees: number | null;
    balance_rupees: number | null;
    advance_mode: 'cash' | 'online' | null;
  };
  delivery: { due_date: string | null };
  confidence_notes: string;
}

/** Mirrors measurementSchema — values verbatim as written. */
export interface MeasurementDraft {
  person_name: string | null;
  garment: string | null;
  measurements: { name: string; value: string }[];
  notes: string | null;
}

/** Mirrors shippingReceiptSchema. */
export interface ShippingReceiptDraft {
  carrier: string | null;
  awb_number: string | null;
  ship_date: string | null;
  destination_hint: string | null;
  notes: string | null;
}

export interface UploadedDocument {
  documentId: string;
  kind: DocumentKind;
  /** Object URL of the compressed photo — usable directly in <img>. */
  previewUrl: string;
}

/** prepareImage → presign → raw PUT. Throws with a friendly message on any step. */
export async function uploadDocument(kind: DocumentKind, file: File): Promise<UploadedDocument> {
  const { blob, contentType } = await prepareImage(file);
  const presign = await api<PresignResult>('/api/admin/uploads/presign', {
    method: 'POST',
    body: { kind, contentType },
  });
  const res = await fetch(presign.uploadUrl, { method: 'PUT', headers: presign.headers, body: blob });
  if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
  return { documentId: presign.documentId, kind, previewUrl: URL.createObjectURL(blob) };
}

/** 503 while ANTHROPIC_API_KEY is unset — callers fall back to manual entry. */
export function parseDocument<T>(documentId: string): Promise<T> {
  return api<T>(`/api/admin/documents/${documentId}/parse`, { method: 'POST' });
}

export function documentViewUrl(documentId: string): Promise<{ url: string }> {
  return api<{ url: string }>(`/api/admin/documents/${documentId}/url`);
}

/**
 * Load a stored photo as an object URL for <img>. Presigned S3 URLs load
 * plainly; the dev-only local transport wants the admin JWT, so retry with it
 * on a 401/403 (never send it to S3 — a signed query + Authorization header is
 * rejected).
 */
export async function fetchDocumentImage(documentId: string): Promise<string> {
  const { url } = await documentViewUrl(documentId);
  let res = await fetch(url);
  if (res.status === 401 || res.status === 403) {
    const token = storedToken();
    if (token) res = await fetch(url, { headers: { Authorization: `Bearer ${token}` } });
  }
  if (!res.ok) throw new Error(`Could not load the photo (${res.status})`);
  return URL.createObjectURL(await res.blob());
}
