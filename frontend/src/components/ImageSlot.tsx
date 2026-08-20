import { useEffect, useState } from 'react';

/** Storefront srcset ladder — keep in sync with admin lib/image.ts and the
 *  renditions backfill (`<master>_w{width}.jpg` siblings in the bucket). */
const RENDITION_WIDTHS = [320, 640, 1080, 1600];

interface ImageSlotProps {
  src?: string | null;
  alt?: string;
  label?: string;
  className?: string;
  // Focal point (percent of the source photo) — steers the object-fit: cover
  // crop via object-position. Omitted means the browser default, centred.
  focusX?: number;
  focusY?: number;
  /** Intrinsic pixel dims of the master photo. Width also gates srcset: no
   *  width means the renditions may not exist, so only plain src is emitted. */
  width?: number | null;
  height?: number | null;
  /** srcset sizes attribute — meaningful only alongside `width`. */
  sizes?: string;
  /** Above-the-fold image: loads eagerly at high fetch priority. */
  eager?: boolean;
  /** '#rrggbb' painted behind the photo while it loads (the piece's colour);
   *  falls back to the .img-slot celadon gradient. */
  placeholderHex?: string | null;
  onClick?: () => void;
}

/** srcset from the `_w{width}.jpg` rendition siblings (only ladder rungs below
 *  the master) plus the master itself as the widest candidate. */
function buildSrcSet(src: string, width: number): string {
  const candidates = RENDITION_WIDTHS.filter((w) => w < width).map(
    (w) => `${src.slice(0, -'.jpg'.length)}_w${w}.jpg ${w}w`,
  );
  candidates.push(`${src} ${width}w`);
  return candidates.join(', ');
}

/** Renders a real <img> when a source exists, otherwise the celadon
 *  gradient placeholder with a sage uppercase caption (reference
 *  <image-slot> empty-state, ported to a .img-slot class). */
export default function ImageSlot({
  src, alt = '', label = '', className = '', focusX, focusY,
  width, height, sizes, eager = false, placeholderHex, onClick,
}: ImageSlotProps) {
  const [loaded, setLoaded] = useState(false);
  // A source swap restarts the placeholder/fade cycle.
  useEffect(() => setLoaded(false), [src]);

  const cls = className ? `img-slot ${className}` : 'img-slot';
  if (src) {
    const style: React.CSSProperties = {};
    if (focusX !== undefined || focusY !== undefined) {
      style.objectPosition = `${focusX ?? 50}% ${focusY ?? 50}%`;
    }
    if (placeholderHex) style.backgroundColor = placeholderHex;
    const withSrcSet = width != null && src.endsWith('.jpg');
    // React 18 has no fetchPriority prop — the lowercase attribute passes
    // through to the DOM untouched (React only camel-cases props it knows).
    const priority = eager ? ({ fetchpriority: 'high' } as Partial<Record<string, string>>) : undefined;
    return (
      <img
        {...priority}
        className={loaded ? `${cls} img-in` : cls}
        src={src}
        srcSet={withSrcSet ? buildSrcSet(src, width!) : undefined}
        sizes={withSrcSet ? sizes : undefined}
        width={width ?? undefined}
        height={height ?? undefined}
        alt={alt || label}
        loading={eager ? 'eager' : 'lazy'}
        decoding="async"
        style={Object.keys(style).length ? style : undefined}
        onLoad={() => setLoaded(true)}
        onClick={onClick}
      />
    );
  }
  return (
    <div className={cls} role="img" aria-label={alt || label} onClick={onClick}>
      <span>{label}</span>
    </div>
  );
}
