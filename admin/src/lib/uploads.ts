// Product-photo upload helper. The presign call goes through the JSON api<T>()
// client; the actual photo bytes go via a RAW fetch PUT to the presigned URL
// (S3 in production, the dev-only /api/uploads/local transport otherwise).
import { api, storedToken } from './api';
import { prepareImage } from './image';

export interface ProductImagePresign {
  key: string;
  uploadUrl: string;
  headers: Record<string, string>;
  /** Permanent public URL — what gets saved into the product's imageUrl. */
  publicUrl: string;
}

/**
 * prepareImage → presign → raw PUT. Throws with a friendly message on any
 * step. The PUT goes plain first (S3 presigned URLs reject an Authorization
 * header); the dev-only local transport answers 401/403 instead, so retry
 * with the admin JWT.
 */
export async function uploadProductImage(file: File): Promise<{ publicUrl: string }> {
  const { blob, contentType } = await prepareImage(file);
  const presign = await api<ProductImagePresign>('/api/admin/uploads/product-image', {
    method: 'POST',
    body: { contentType },
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
  return { publicUrl: presign.publicUrl };
}
