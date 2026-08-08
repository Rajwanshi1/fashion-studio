interface SkeletonProps {
  variant?: 'rows' | 'cards' | 'stats';
  count?: number;
  label?: string;
}

/** Loading placeholder shaped like the content it replaces. */
export default function Skeleton({ variant = 'rows', count = 3, label = 'Loading' }: SkeletonProps) {
  return (
    <div className={`skel skel-${variant}`} role="status" aria-label={label}>
      {Array.from({ length: count }, (_, i) => (
        <div className="skel-block" key={i} />
      ))}
    </div>
  );
}
