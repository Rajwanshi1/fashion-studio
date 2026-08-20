import { afterEach, beforeEach, describe, expect, it, vi, type Mock } from 'vitest';

const heif = vi.hoisted(() => ({ decode: vi.fn() }));

vi.mock('libheif-js/wasm-bundle', () => ({
  default: {
    HeifDecoder: class {
      decode = heif.decode;
    },
  },
}));

import { DECODE_MESSAGE, prepareImage, prepareRenditions } from '../lib/image';

function fakeBitmap(width = 4000, height = 3000) {
  return { width, height, close: vi.fn() } as unknown as ImageBitmap;
}

/** A HEIC/HEIF/AVIF container is recognised by `ftyp` at byte offset 4. */
function isoFile(name: string, type: string): File {
  const head = new Uint8Array([0, 0, 0, 24, 0x66, 0x74, 0x79, 0x70, 0x68, 0x65, 0x69, 0x63]);
  return new File([head], name, { type });
}

function fakeHeifImage(width: number, height: number) {
  return {
    get_width: () => width,
    get_height: () => height,
    display: (target: unknown, done: (result: unknown) => void) => done(target),
  };
}

describe('prepareImage', () => {
  let createBitmap: Mock;
  let drawImage: Mock;
  let warn: Mock;

  beforeEach(() => {
    heif.decode.mockReset();
    createBitmap = vi.fn(async () => fakeBitmap());
    drawImage = vi.fn();
    vi.stubGlobal('createImageBitmap', createBitmap);
    warn = vi.fn();
    vi.stubGlobal('console', { ...console, warn });

    HTMLCanvasElement.prototype.getContext = vi.fn(
      () =>
        ({
          drawImage,
          createImageData: (w: number, h: number) => ({
            data: new Uint8ClampedArray(w * h * 4),
            width: w,
            height: h,
          }),
          putImageData: vi.fn(),
        }) as unknown as CanvasRenderingContext2D,
    ) as never;
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(new Blob(['resized'], { type: 'image/jpeg' }));
    };
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('re-encodes a plain JPEG without downloading the wasm decoder', async () => {
    const file = new File(['x'], 'bill.jpg', { type: 'image/jpeg' });
    const { blob, contentType } = await prepareImage(file);
    expect(contentType).toBe('image/jpeg');
    expect(blob.type).toBe('image/jpeg');
    expect(createBitmap).toHaveBeenCalledWith(file);
    expect(heif.decode).not.toHaveBeenCalled();
  });

  it('prefers the browser decoder for HEIC when it has one (Safari, iOS)', async () => {
    const file = isoFile('IMG_0001.HEIC', 'image/heic');
    await prepareImage(file);
    expect(createBitmap).toHaveBeenCalledWith(file);
    expect(heif.decode).not.toHaveBeenCalled();
  });

  it('falls back to libheif when the browser cannot decode the HEIC', async () => {
    createBitmap.mockRejectedValue(new Error('The source image could not be decoded.'));
    heif.decode.mockReturnValue([fakeHeifImage(60, 40)]);

    const file = isoFile('IMG_3765.HEIC', 'image/heic');
    const { contentType } = await prepareImage(file);

    expect(contentType).toBe('image/jpeg');
    expect(heif.decode).toHaveBeenCalledTimes(1);
    // The decoded canvas, not the original file, is what gets downscaled.
    expect(drawImage).toHaveBeenCalledWith(expect.any(HTMLCanvasElement), 0, 0, 60, 40);
  });

  it('downscales the longest side to 2000px', async () => {
    const file = new File(['x'], 'bill.jpg', { type: 'image/jpeg' });
    await prepareImage(file);
    expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 2000, 1500);
  });

  it('reports the re-encoded master dimensions (post-downscale)', async () => {
    const file = new File(['x'], 'shot.jpg', { type: 'image/jpeg' });
    const { width, height } = await prepareImage(file);
    // 4000x3000 source → 2000x1500 master.
    expect(width).toBe(2000);
    expect(height).toBe(1500);
  });

  it('skips the wasm decoder for a file that is not an ISO container', async () => {
    createBitmap.mockRejectedValue(new Error('unsupported'));
    const file = new File(['not an image at all'], 'weird.bin', { type: 'application/octet-stream' });

    await expect(prepareImage(file)).rejects.toThrow(DECODE_MESSAGE);
    expect(heif.decode).not.toHaveBeenCalled();
  });

  it("surfaces the decoder's own reason instead of masking it", async () => {
    createBitmap.mockRejectedValue(new Error('The source image could not be decoded.'));
    // libheif rejects with a plain object, not an Error.
    heif.decode.mockImplementation(() => {
      throw { code: 2, message: 'ERR_LIBHEIF format not supported' };
    });

    const file = isoFile('IMG_3765.HEIC', 'image/heic');
    await expect(prepareImage(file)).rejects.toThrow('ERR_LIBHEIF format not supported');
    // The reason names the decoder that failed, so a screenshot of the toast is
    // enough to diagnose the next report.
    expect(warn).toHaveBeenCalledWith(
      '[intake] photo decode failed',
      expect.objectContaining({
        name: 'IMG_3765.HEIC',
        reason: 'libheif: ERR_LIBHEIF format not supported',
      }),
    );
  });

  it('reports a re-encode failure separately from a decode failure', async () => {
    HTMLCanvasElement.prototype.toBlob = function (cb: BlobCallback) {
      cb(null);
    };
    const file = new File(['x'], 'bill.jpg', { type: 'image/jpeg' });
    await expect(prepareImage(file)).rejects.toThrow('Could not re-encode that photo in this browser.');
  });

  describe('prepareRenditions', () => {
    const master = new Blob(['master'], { type: 'image/jpeg' });

    it('generates only ladder widths below the master, at proportional heights', async () => {
      createBitmap.mockResolvedValue(fakeBitmap(2000, 1500));
      const renditions = await prepareRenditions(master, 2000, 1500, [320, 640, 1080, 1600]);
      expect(renditions.map((r) => r.width)).toEqual([320, 640, 1080, 1600]);
      expect(renditions.every((r) => r.blob.type === 'image/jpeg')).toBe(true);
      // Heights keep the master's aspect: round(1500 * w / 2000).
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 320, 240);
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 640, 480);
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1080, 810);
      expect(drawImage).toHaveBeenCalledWith(expect.anything(), 0, 0, 1600, 1200);
    });

    it('skips widths at or above the master (never upscales)', async () => {
      createBitmap.mockResolvedValue(fakeBitmap(1080, 1350));
      const renditions = await prepareRenditions(master, 1080, 1350, [320, 640, 1080, 1600]);
      expect(renditions.map((r) => r.width)).toEqual([320, 640]);
    });

    it('returns [] without decoding when no ladder width fits', async () => {
      const renditions = await prepareRenditions(master, 320, 400, [320, 640, 1080, 1600]);
      expect(renditions).toEqual([]);
      expect(createBitmap).not.toHaveBeenCalled();
    });
  });
});
