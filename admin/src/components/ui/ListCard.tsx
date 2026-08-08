import type { KeyboardEvent, ReactNode } from 'react';

interface ListCardProps {
  /** Headline line — who/what (serif). */
  primary: ReactNode;
  /** Muted second line — order no, dates. */
  secondary?: ReactNode;
  /** Right-aligned figure — amount, count. */
  meta?: ReactNode;
  badges?: ReactNode;
  actions?: ReactNode;
  onClick?: () => void;
  /** Accessible name when the whole card is tappable. */
  ariaLabel?: string;
}

/** The Deliveries card pattern, generalized: summary-first rows for phone lists. */
export default function ListCard({
  primary,
  secondary,
  meta,
  badges,
  actions,
  onClick,
  ariaLabel,
}: ListCardProps) {
  const interactive = Boolean(onClick);
  const onKeyDown = (e: KeyboardEvent) => {
    if (!onClick) return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onClick();
    }
  };
  return (
    <article
      className={interactive ? 'lcard hit' : 'lcard'}
      role={interactive ? 'button' : undefined}
      tabIndex={interactive ? 0 : undefined}
      aria-label={interactive ? ariaLabel : undefined}
      onClick={onClick}
      onKeyDown={onKeyDown}
    >
      <div className="lcard-top">
        <div className="lcard-main">
          <div className="lcard-primary">{primary}</div>
          {secondary && <div className="lcard-secondary">{secondary}</div>}
        </div>
        {meta && <div className="lcard-meta">{meta}</div>}
      </div>
      {badges && <div className="lcard-badges">{badges}</div>}
      {actions && (
        <div className="lcard-actions" onClick={(e) => e.stopPropagation()}>
          {actions}
        </div>
      )}
    </article>
  );
}
