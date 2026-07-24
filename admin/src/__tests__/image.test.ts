import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

vi.mock('heic2any', () => ({ default: vi.fn() }));

import heic2any from 'heic2any';
import { prepareImage } from '../lib/image';

const heicMock = heic2any as unknown as Mock;
const JPEG_BLOB = new Blob(['converted'], { type: 'image/jpeg' });

function fakeBitmap() {
  return { width: 4000, height: 3000, close: vi.fn() } as unknown as ImageBitmap;
}

describe('prepareImage', () => {
  let createBitmap: Mock;

  beforeEach(() => {
    heicMock.mockReset();
    createBitmap = vi.fn(async () => fakeBitmap());
    vi.stubGlobal('createImageBitmap', createBitmap);
    HTMLCanvasElement.prototype.getContext = vi.fn(
      () => ({ drawImage: vi.fn() }) as unknown as CanvasRenderingContext2D,
    ) as never;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob(['resized'], { type: 'image/jpeg' }));
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-encodes a plain JPEG without touching the HEIC decoder', async () => {
    const file = new File(['x'], 'bill.jpg', { type: 'image/jpeg' });
    const { blob, contentType } = await prepareImage(file);
    expect(contentType).toBe('image/jpeg');
    expect(blob.type).toBe('image/jpeg');
    expect(heicMock).not.toHaveBeenCalled();
    expect(createBitmap).toHaveBeenCalledWith(file);
  });

  it('converts a HEIC file through heic2any before decoding', async () => {
    heicMock.mockResolvedValue(JPEG_BLOB);
    const file = new File(['x'], 'IMG_0001.HEIC', { type: 'image/heic' });
    const { contentType } = await prepareImage(file);
    expect(contentType).toBe('image/jpeg');
    expect(heicMock).toHaveBeenCalledWith({ blob: file, toType: 'image/jpeg', quality: 0.9 });
    expect(createBitmap).toHaveBeenCalledWith(JPEG_BLOB);
  });

  it('detects HEIC by file extension even when the type is missing', async () => {
    heicMock.mockResolvedValue(JPEG_BLOB);
    const file = new File(['x'], 'photo.heif', { type: '' });
    await prepareImage(file);
    expect(heicMock).toHaveBeenCalledTimes(1);
  });

  it('retries a mistyped HEIC through the converter when native decode fails', async () => {
    heicMock.mockResolvedValue(JPEG_BLOB);
    const file = new File(['x'], 'photo.jpg', { type: 'image/jpeg' }); // lying picker
    createBitmap
      .mockRejectedValueOnce(new Error('unsupported'))
      .mockImplementationOnce(async () => fakeBitmap());
    const { contentType } = await prepareImage(file);
    expect(contentType).toBe('image/jpeg');
    expect(heicMock).toHaveBeenCalledTimes(1);
  });

  it('throws the friendly error when both native decode and conversion fail', async () => {
    heicMock.mockRejectedValue(new Error('not a heic'));
    createBitmap.mockRejectedValue(new Error('unsupported'));
    const file = new File(['x'], 'weird.bin', { type: 'application/octet-stream' });
    await expect(prepareImage(file)).rejects.toThrow(
      'Could not read that image. Use the camera option or a JPEG photo.',
    );
  });
});
