/**
 * Downscale + re-encode a captured photo before upload: longest side ≤ 2000px,
 * JPEG at 0.8 quality. Keeps handwritten bills legible for Claude while
 * staying well under the 10 MB transport cap.
 *
 * iPhone photos picked from the library often arrive as HEIC, which most
 * browsers cannot decode natively. Those are converted to JPEG first through
 * heic2any (wasm libheif), loaded lazily so the ~1 MB decoder only downloads
 * when a HEIC file is actually selected. Files with a lying content type
 * (some pickers report octet-stream or jpeg for HEIC) get one conversion
 * retry after the native decode fails.
 */

const DECODE_ERROR = 'Could not read that image. Use the camera option or a JPEG photo.';

function looksLikeHeic(file: File): boolean {
  return /image\/hei[cf]/i.test(file.type) || /\.hei[cf]$/i.test(file.name);
}

async function heicToJpeg(file: File): Promise<Blob> {
  const { default: heic2any } = await import('heic2any');
  const converted = await heic2any({ blob: file, toType: 'image/jpeg', quality: 0.9 });
  return Array.isArray(converted) ? converted[0] : converted;
}

async function decodeBitmap(file: File): Promise<ImageBitmap> {
  if (looksLikeHeic(file)) {
    return createImageBitmap(await heicToJpeg(file));
  }
  try {
    return await createImageBitmap(file);
  } catch {
    // Mistyped HEIC — one conversion retry before giving up.
    return createImageBitmap(await heicToJpeg(file));
  }
}

export async function prepareImage(file: File): Promise<{ blob: Blob; contentType: 'image/jpeg' }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await decodeBitmap(file);
  } catch {
    throw new Error(DECODE_ERROR);
  }

  const MAX_SIDE = 2000;
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height));
  const width = Math.max(1, Math.round(bitmap.width * scale));
  const height = Math.max(1, Math.round(bitmap.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d');
  if (!ctx) {
    bitmap.close();
    throw new Error('Could not process the photo in this browser.');
  }
  ctx.drawImage(bitmap, 0, 0, width, height);
  bitmap.close();

  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.8));
  if (!blob) throw new Error(DECODE_ERROR);
  return { blob, contentType: 'image/jpeg' };
}
