/**
 * Prepare a captured photo for upload: decode it, downscale to a 2000px longest
 * side, re-encode as JPEG. That keeps handwritten bills legible for Claude
 * while staying well under the 10 MB transport cap.
 *
 * The decode order is deliberate:
 *   1. The browser's own decoder. Safari and iOS read HEIC natively, so the
 *      phones this wizard is built for never pay for a wasm download.
 *   2. libheif compiled to wasm, imported lazily. Chromium and Firefox cannot
 *      read HEIC at all, and 24 MP iPhone photos use the 10-bit `heix` profile
 *      that older libheif builds reject with ERR_LIBHEIF format not supported.
 *
 * Failures carry the decoder's own reason. A single generic message here hid
 * that libheif error through three rounds of guessing.
 */

const MAX_SIDE = 2000;

/**
 * Claude 5 reads images up to 2576 px on the long edge without downscaling them,
 * so a 2000 px photo reaches the model at full size and JPEG compression is the
 * only thing left between the handwriting and the OCR. Anthropic's own guidance
 * warns that heavy compression makes text hard to read, hence 0.92 rather than a
 * web-typical 0.8. A 2000 px bill lands around 1 MB, comfortably under the 5 MB
 * per-image limit on the transport.
 */
const JPEG_QUALITY = 0.92;

export const DECODE_MESSAGE = 'Could not read that image. Use the camera option or a JPEG photo.';

interface Decoded {
  source: CanvasImageSource;
  width: number;
  height: number;
  release(): void;
}

function reasonFor(err: unknown): string {
  if (err instanceof Error) return err.message;
  // libheif rejects with a plain { code, message } object rather than an Error.
  if (err && typeof err === 'object') {
    const { message } = err as { message?: unknown };
    if (typeof message === 'string') return message;
    return JSON.stringify(err).slice(0, 120);
  }
  return String(err);
}

async function decodeNatively(file: Blob): Promise<Decoded> {
  const bitmap = await createImageBitmap(file);
  return {
    source: bitmap,
    width: bitmap.width,
    height: bitmap.height,
    release: () => bitmap.close(),
  };
}

/**
 * ISO base-media containers — HEIC, HEIF, AVIF — all carry `ftyp` at byte 4.
 * Used only to avoid downloading the wasm decoder for something it could never
 * read; when the header cannot be inspected we let the decoder decide, because
 * skipping it silently is how the original bug stayed hidden.
 */
async function mayBeHeif(file: Blob): Promise<boolean> {
  let head: Uint8Array;
  try {
    head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  } catch {
    return true;
  }
  if (head.length < 8) return true;
  return String.fromCharCode(...head.subarray(4, 8)) === 'ftyp';
}

async function decodeWithLibheif(file: Blob): Promise<Decoded> {
  const { default: libheif } = await import('libheif-js/wasm-bundle');
  const images = new libheif.HeifDecoder().decode(new Uint8Array(await file.arrayBuffer()));
  const image = images?.[0];
  if (!image) throw new Error('no HEIF image found in the file');

  const width = image.get_width();
  const height = image.get_height();
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('canvas 2d context unavailable');

  // libheif fills the target in place, but older builds hand back their own
  // buffer instead — copy across when that happens.
  const target = ctx.createImageData(width, height);
  const rendered = await new Promise<{ data: Uint8ClampedArray }>((resolve, reject) => {
    image.display(target, (result) =>
      result ? resolve(result) : reject(new Error('libheif could not render the image')),
    );
  });
  if (rendered.data !== target.data) target.data.set(rendered.data);
  ctx.putImageData(target, 0, 0);

  return {
    source: canvas,
    width,
    height,
    release: () => {
      canvas.width = 0;
      canvas.height = 0;
    },
  };
}

async function decode(file: File): Promise<Decoded> {
  const reasons: string[] = [];
  try {
    return await decodeNatively(file);
  } catch (err) {
    reasons.push(`browser: ${reasonFor(err)}`);
  }
  // Only worth downloading the wasm decoder for a container it could read.
  if (await mayBeHeif(file)) {
    try {
      return await decodeWithLibheif(file);
    } catch (err) {
      reasons.push(`libheif: ${reasonFor(err)}`);
    }
  }
  throw new Error(reasons[reasons.length - 1] ?? 'unknown decode failure');
}

export async function prepareImage(file: File): Promise<{ blob: Blob; contentType: 'image/jpeg' }> {
  let decoded: Decoded;
  try {
    decoded = await decode(file);
  } catch (err) {
    console.warn('[intake] photo decode failed', {
      name: file.name,
      type: file.type,
      bytes: file.size,
      reason: reasonFor(err),
    });
    throw new Error(`${DECODE_MESSAGE} (${reasonFor(err)})`);
  }

  const scale = Math.min(1, MAX_SIDE / Math.max(decoded.width, decoded.height));
  const width = Math.max(1, Math.round(decoded.width * scale));
  const height = Math.max(1, Math.round(decoded.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    decoded.release();
    throw new Error('Could not process the photo in this browser.');
  }
  ctx.drawImage(decoded.source, 0, 0, width, height);
  decoded.release();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', JPEG_QUALITY));
  if (!blob) throw new Error('Could not re-encode that photo in this browser.');
  return { blob, contentType: 'image/jpeg' };
}
