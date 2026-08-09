// Shared upload helpers for admin photo uploads: product images (Products /
// ProductEdit) and customer documents (the bill-intake wizard and the orders
// page). The presign + parse + view-url calls go through the JSON api<T>()
// client; the actual photo bytes go via a RAW fetch PUT to the presigned URL
// (S3 in production, the dev-only /api/uploads/local transport otherwise).
import { api, storedToken } from './api';
import { prepareImage } from './image';
import type { DocumentKind } from './types';

export interface PresignResult {
  documentId: string;
  uploadUrl: string;
  headers: Record<string, string>;
}

/**
 * Mirrors backend/src/services/ai/prompts.ts billSchema — all rupees as written.
 *
 * Note the asymmetry with the other two drafts: bill STRING fields are plain
 * `string` using "" for absent, because billSchema is the only one big enough to
 * hit the API's 16-union-parameter ceiling (see `emptyableString` there). Number
 * fields keep `| null` — 0 is a real rupee value.
 */
export interface BillDraft {
  bill: {
    bill_number: string;
    bill_date: string;
    bill_type: 'gst_invoice' | 'cash_memo' | null;
    channel_guess: 'in_store' | 'instagram' | 'exhibition' | null;
  };
  customer: {
    name: string;
    phone: string;
    email: string;
    address: string;
    city: string;
    state: string;
    pincode: string;
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
  delivery: { due_date: string };
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

/**
 * prepareImage → presign → raw PUT. Throws with a friendly message on any
 * step. The PUT goes plain first (S3 presigned URLs reject an Authorization
 * header); the dev-only local transport answers 401/403 instead, so retry
 * with the admin JWT — mirroring fetchDocumentImage.
 */
export async function uploadDocument(kind: DocumentKind, file: File): Promise<UploadedDocument> {
  const { blob, contentType } = await prepareImage(file);
  const presign = await api<PresignResult>('/api/admin/uploads/presign', {
    method: 'POST',
    body: { kind, contentType },
  });
  let res = await fetch(presign.uploadUrl, { method: 'PUT', headers: presign.headers, body: blob });
  if (res.status === 401 || res.status === 403) {
    const token = storedToken();
    if (token) {
      res = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { ...presign.headers, Authorization: `Bearer ${token}` },
        body: blob,
      });
    }
  }
  if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
  return { documentId: presign.documentId, kind, previewUrl: URL.createObjectURL(blob) };
}

/** 503 while ANTHROPIC_API_KEY is unset — callers fall back to manual entry. */
export function parseDocument<T>(documentId: string): Promise<T> {
  // OCR runs a model call; give it well beyond the default API timeout.
  return api<T>(`/api/admin/documents/${documentId}/parse`, { method: 'POST', timeoutMs: 120_000 });
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


export interface ProductImagePresign {
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
  /** Permanent public URL — what gets saved into the product's gallery. */
  publicUrl: string;
  /** Pose Claude read off the photo ('front', 'drape', …); null when unnamed. */
  pose?: string | null;
}

/**
 * btoa() takes a binary string, and String.fromCharCode(...bytes) blows the
 * call stack somewhere north of 100k arguments — a 2000px JPEG is comfortably
 * past that. 32k-byte chunks stay well inside every engine's limit.
 */
const B64_CHUNK = 0x8000;

function base64(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i += B64_CHUNK) {
    binary += String.fromCharCode(...bytes.subarray(i, i + B64_CHUNK));
  }
  return btoa(binary);
}

/**
 * prepareImage → presign → raw PUT. Throws with a friendly message on any
 * step. The PUT goes plain first (S3 presigned URLs reject an Authorization
 * header); the dev-only local transport answers 401/403 instead, so retry
 * with the admin JWT — the same dance as uploadDocument.
 *
 * Passing `productName` opts into AI naming: the photo travels along as base64
 * so the server can name the object after what it shows ("emerald-gown-front")
 * instead of a uuid, and answers with the pose it read. That body runs a few
 * MB, so a failed presign is retried once WITHOUT the naming fields — a name
 * is a nicety, the upload is not.
 */
export async function uploadProductImage(
  file: File,
  productName?: string,
): Promise<{ publicUrl: string; pose: string | null }> {
  const { blob, contentType } = await prepareImage(file);
  const name = productName?.trim() ?? '';
  const plainBody = { contentType };
  const body = name
    ? { ...plainBody, productName: name, imageBase64: base64(new Uint8Array(await blob.arrayBuffer())) }
    : plainBody;

  let presign: ProductImagePresign;
  try {
    // The naming variant carries the whole photo as base64 — allow for a slow uplink.
    presign = await api<ProductImagePresign>('/api/admin/uploads/product-image', {
      method: 'POST',
      body,
      timeoutMs: 120_000,
    });
  } catch (err) {
    if (!name) throw err;
    presign = await api<ProductImagePresign>('/api/admin/uploads/product-image', {
      method: 'POST',
      body: plainBody,
    });
  }
  let res = await fetch(presign.uploadUrl, { method: 'PUT', headers: presign.headers, body: blob });
  if (res.status === 401 || res.status === 403) {
    const token = storedToken();
    if (token) {
      res = await fetch(presign.uploadUrl, {
        method: 'PUT',
        headers: { ...presign.headers, Authorization: `Bearer ${token}` },
        body: blob,
      });
    }
  }
  if (!res.ok) throw new Error(`Photo upload failed (${res.status})`);
  return { publicUrl: presign.publicUrl, pose: presign.pose ?? null };
}
