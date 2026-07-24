import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/image', () => ({
  prepareImage: vi.fn(async () => ({
    blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
    contentType: 'image/jpeg' as const,
  })),
}));

import { uploadDocument } from '../lib/uploads';
import { mockFetch, seedAdminAuth } from '../test/utils';

const PRESIGN = {
  documentId: 'doc-1',
  uploadUrl: 'http://localhost:3001/api/uploads/local/bill%2Fkey.jpg',
  headers: { 'Content-Type': 'image/jpeg' },
};

describe('uploadDocument', () => {
  beforeEach(() => {
    seedAdminAuth();
    vi.stubGlobal('URL', Object.assign(URL, { createObjectURL: vi.fn(() => 'blob:preview') }));
  });

  it('retries the PUT with the admin JWT when the dev transport answers 401', async () => {
    const puts: { auth: string | undefined }[] = [];
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/uploads/presign')) return { json: PRESIGN };
      if (url === PRESIGN.uploadUrl && init?.method === 'PUT') {
        const headers = (init.headers ?? {}) as Record<string, string>;
        puts.push({ auth: headers.Authorization });
        return headers.Authorization ? { status: 204, json: undefined } : { status: 401, json: {} };
      }
      return undefined;
    });

    const doc = await uploadDocument('bill', new File(['x'], 'bill.jpg', { type: 'image/jpeg' }));
    expect(doc.documentId).toBe('doc-1');
    expect(puts).toHaveLength(2);
    expect(puts[0].auth).toBeUndefined(); // plain first — S3 rejects an Authorization header
    expect(puts[1].auth).toMatch(/^Bearer /);
  });

  it('does not retry when the first PUT succeeds (S3 path)', async () => {
    let putCount = 0;
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/uploads/presign')) return { json: PRESIGN };
      if (init?.method === 'PUT') {
        putCount += 1;
        return { status: 200, json: {} };
      }
      return undefined;
    });

    await uploadDocument('bill', new File(['x'], 'bill.jpg', { type: 'image/jpeg' }));
    expect(putCount).toBe(1);
  });

  it('surfaces a friendly error when the PUT still fails', async () => {
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/uploads/presign')) return { json: PRESIGN };
      if (init?.method === 'PUT') return { status: 413, json: {} };
      return undefined;
    });

    await expect(
      uploadDocument('bill', new File(['x'], 'bill.jpg', { type: 'image/jpeg' })),
    ).rejects.toThrow('Photo upload failed (413)');
  });
});
