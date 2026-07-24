/**
 * Downscale + re-encode a captured photo before upload: longest side ≤ 2000px,
 * JPEG at 0.8 quality. Keeps handwritten bills legible for Claude while staying
 * well under the 10 MB transport cap. iOS HEIC via the camera input usually
 * arrives as JPEG already — the decode guard catches anything the browser
 * cannot read.
 */
export async function prepareImage(file: File): Promise<{ blob: Blob; contentType: 'image/jpeg' }> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    throw new Error('Could not read that image. Use the camera option or a JPEG photo.');
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
  if (!blob) throw new Error('Could not read that image. Use the camera option or a JPEG photo.');
  return { blob, contentType: 'image/jpeg' };
}
