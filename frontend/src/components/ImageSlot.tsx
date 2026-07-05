interface ImageSlotProps {
  src?: string | null;
  alt?: string;
  label?: string;
  className?: string;
  onClick?: () => void;
}

/** Renders a real <img> when a source exists, otherwise the celadon
 *  gradient placeholder with a sage uppercase caption (reference
 *  <image-slot> empty-state, ported to a .img-slot class). */
export default function ImageSlot({ src, alt = '', label = '', className = '', onClick }: ImageSlotProps) {
  const cls = className ? `img-slot ${className}` : 'img-slot';
  if (src) {
    return <img className={cls} src={src} alt={alt || label} onClick={onClick} />;
  }
  return (
    <div className={cls} role="img" aria-label={alt || label} onClick={onClick}>
      <span>{label}</span>
    </div>
  );
}
