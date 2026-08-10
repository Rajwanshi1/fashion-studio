interface ImageSlotProps {
  src?: string | null;
  alt?: string;
  label?: string;
  className?: string;
  // Focal point (percent of the source photo) — steers the object-fit: cover
  // crop via object-position. Omitted means the browser default, centred.
  focusX?: number;
  focusY?: number;
  onClick?: () => void;
}

/** Renders a real <img> when a source exists, otherwise the celadon
 *  gradient placeholder with a sage uppercase caption (reference
 *  <image-slot> empty-state, ported to a .img-slot class). */
export default function ImageSlot({
  src, alt = '', label = '', className = '', focusX, focusY, onClick,
}: ImageSlotProps) {
  const cls = className ? `img-slot ${className}` : 'img-slot';
  if (src) {
    const style = focusX !== undefined || focusY !== undefined
      ? { objectPosition: `${focusX ?? 50}% ${focusY ?? 50}%` }
      : undefined;
    return <img className={cls} src={src} alt={alt || label} style={style} onClick={onClick} />;
  }
  return (
    <div className={cls} role="img" aria-label={alt || label} onClick={onClick}>
      <span>{label}</span>
    </div>
  );
}
