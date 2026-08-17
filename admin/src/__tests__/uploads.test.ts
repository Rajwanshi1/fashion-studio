import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('../lib/image', () => ({
  RENDITION_WIDTHS: [320, 640, 1080, 1600],
  prepareImage: vi.fn(async () => ({
    blob: new Blob(['jpeg'], { type: 'image/jpeg' }),
    contentType: 'image/jpeg' as const,
    width: 2000,
    height: 2500,
  })),
  prepareRenditions: vi.fn(async (_master: Blob, _w: number, _h: number, widths: number[]) =>
    widths.map((width) => ({ width, blob: new Blob([`r${width}`], { type: 'image/jpeg' }) })),
  ),
}));

import { prepareImage, prepareRenditions } from '../lib/image';
import { uploadDocument, uploadProductImage } from '../lib/uploads';
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

const IMMUTABLE = 'public,max-age=31536000,immutable';
const ALL_WIDTHS = [320, 640, 1080, 1600];

const PRODUCT_PRESIGN = {
  key: 'products/2026/08/emerald-gown-front-a1b2c3.jpg',
  uploadUrl: 'http://localhost:3001/api/uploads/local/products%2Fkey.jpg',
  headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': IMMUTABLE },
  publicUrl: 'https://cdn.example/products/2026/08/emerald-gown-front-a1b2c3.jpg',
  pose: 'front',
  color: 'Emerald',
  colorHex: '#0f6b4f',
  renditions: ALL_WIDTHS.map((width) => ({
    width,
    key: `products/2026/08/emerald-gown-front-a1b2c3_w${width}.jpg`,
    uploadUrl: `http://localhost:3001/api/uploads/local/products%2Fkey_w${width}.jpg`,
    headers: { 'Content-Type': 'image/jpeg', 'Cache-Control': IMMUTABLE },
  })),
};

interface PresignBody {
  contentType: string;
  productName?: string;
  imageBase64?: string;
  renditionWidths?: number[];
}

describe('uploadProductImage', () => {
  beforeEach(() => {
    seedAdminAuth();
  });

  /** Records every presign body, answers the presign then the raw PUT. */
  function stubPresign(respond: (attempt: number) => { status?: number; json: unknown }) {
    const bodies: PresignBody[] = [];
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/uploads/product-image')) {
        bodies.push(JSON.parse(String(init?.body)) as PresignBody);
        return respond(bodies.length);
      }
      if (init?.method === 'PUT') return { status: 200, json: {} };
      return undefined;
    });
    return bodies;
  }

  it('sends the product name, the photo bytes and the rendition widths below the master', async () => {
    const bodies = stubPresign(() => ({ json: PRODUCT_PRESIGN }));

    const result = await uploadProductImage(
      new File(['x'], 'shot.jpg', { type: 'image/jpeg' }),
      '  Emerald Court Gown  ',
    );

    expect(bodies).toHaveLength(1);
    expect(bodies[0].contentType).toBe('image/jpeg');
    expect(bodies[0].productName).toBe('Emerald Court Gown'); // trimmed
    expect(bodies[0].renditionWidths).toEqual(ALL_WIDTHS); // master is 2000px wide
    expect(atob(String(bodies[0].imageBase64))).toBe('jpeg'); // the prepared blob
    expect(result).toEqual({
      publicUrl: PRODUCT_PRESIGN.publicUrl,
      pose: 'front',
      color: 'Emerald',
      colorHex: '#0f6b4f',
      // Every rendition PUT succeeded → the dims are claimed.
      width: 2000,
      height: 2500,
    });
  });

  it('PUTs the master and every rendition in parallel with each presign\'s own headers', async () => {
    const puts: { url: string; cacheControl?: string }[] = [];
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/uploads/product-image')) return { json: PRODUCT_PRESIGN };
      if (init?.method === 'PUT') {
        const headers = (init.headers ?? {}) as Record<string, string>;
        puts.push({ url, cacheControl: headers['Cache-Control'] });
        return { status: 200, json: {} };
      }
      return undefined;
    });

    await uploadProductImage(new File(['x'], 'shot.jpg', { type: 'image/jpeg' }), 'Emerald Court Gown');

    expect(puts.map((p) => p.url).sort()).toEqual(
      [PRODUCT_PRESIGN.uploadUrl, ...PRODUCT_PRESIGN.renditions.map((r) => r.uploadUrl)].sort(),
    );
    // Cache-Control travels on every PUT — it is part of each presign's contract.
    for (const put of puts) expect(put.cacheControl).toBe(IMMUTABLE);
    // The renditions were cut from the prepared master at its real dimensions.
    expect(vi.mocked(prepareRenditions)).toHaveBeenCalledWith(expect.any(Blob), 2000, 2500, ALL_WIDTHS);
  });

  it('nulls the dims when ANY rendition PUT fails, so the storefront never emits a broken srcset', async () => {
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/uploads/product-image')) return { json: PRODUCT_PRESIGN };
      if (init?.method === 'PUT') {
        // One rendition fails; the master and the rest succeed.
        if (url.endsWith('key_w640.jpg')) return { status: 500, json: {} };
        return { status: 200, json: {} };
      }
      return undefined;
    });

    const result = await uploadProductImage(new File(['x'], 'shot.jpg', { type: 'image/jpeg' }));

    expect(result.publicUrl).toBe(PRODUCT_PRESIGN.publicUrl); // the upload itself survives
    expect(result.width).toBeNull();
    expect(result.height).toBeNull();
  });

  it('nulls the dims when the server presigned fewer renditions than requested', async () => {
    stubPresign(() => ({ json: { ...PRODUCT_PRESIGN, renditions: PRODUCT_PRESIGN.renditions.slice(0, 2) } }));

    const result = await uploadProductImage(new File(['x'], 'shot.jpg', { type: 'image/jpeg' }));

    expect(result.width).toBeNull();
    expect(result.height).toBeNull();
  });

  it('omits the naming fields without a product name, and reports a null pose and colour', async () => {
    const bodies = stubPresign(() => ({
      json: { ...PRODUCT_PRESIGN, pose: undefined, color: undefined, colorHex: undefined },
    }));

    const result = await uploadProductImage(new File(['x'], 'shot.jpg', { type: 'image/jpeg' }));

    expect(bodies).toEqual([{ contentType: 'image/jpeg', renditionWidths: ALL_WIDTHS }]);
    expect(result.pose).toBeNull();
    expect(result.color).toBeNull();
    expect(result.colorHex).toBeNull();
  });

  it('retries the presign without the naming fields when the first attempt fails', async () => {
    // A multi-MB base64 body is the one part of this request that can be
    // rejected for size — a name is a nicety, the upload is not.
    const bodies = stubPresign((attempt) =>
      attempt === 1 ? { status: 413, json: { error: 'Payload too large' } } : { json: PRODUCT_PRESIGN },
    );

    const result = await uploadProductImage(
      new File(['x'], 'shot.jpg', { type: 'image/jpeg' }),
      'Emerald Court Gown',
    );

    expect(bodies).toHaveLength(2);
    expect(bodies[0].productName).toBe('Emerald Court Gown');
    expect(bodies[1]).toEqual({ contentType: 'image/jpeg', renditionWidths: ALL_WIDTHS });
    expect(result.publicUrl).toBe(PRODUCT_PRESIGN.publicUrl);
  });

  it('surfaces the presign error when the retry-free path fails', async () => {
    stubPresign(() => ({ status: 500, json: { error: 'Storage is not configured' } }));

    await expect(
      uploadProductImage(new File(['x'], 'shot.jpg', { type: 'image/jpeg' })),
    ).rejects.toThrow('Storage is not configured');
  });

  it('base64-encodes a multi-KB photo across chunk boundaries', async () => {
    const bytes = new Uint8Array(100_000);
    for (let i = 0; i < bytes.length; i += 1) bytes[i] = (i * 7) % 256;
    vi.mocked(prepareImage).mockResolvedValueOnce({
      blob: new Blob([bytes], { type: 'image/jpeg' }),
      contentType: 'image/jpeg',
      width: 2000,
      height: 2500,
    });
    const bodies = stubPresign(() => ({ json: PRODUCT_PRESIGN }));

    await uploadProductImage(new File(['x'], 'shot.jpg', { type: 'image/jpeg' }), 'Emerald Court Gown');

    const decoded = Uint8Array.from(atob(String(bodies[0].imageBase64)), (c) => c.charCodeAt(0));
    expect(decoded).toEqual(bytes);
  });
});
