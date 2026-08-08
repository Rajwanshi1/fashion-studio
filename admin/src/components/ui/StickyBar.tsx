import type { ReactNode } from 'react';

interface StickyBarProps {
  children: ReactNode;
  /** Pre-formatted error summary, e.g. "3 fields need attention". */
  error?: string | null;
  /** When set, the error summary becomes a button that jumps to the first error. */
  onErrorClick?: () => void;
}

/** Sticky bottom bar for long forms — submit and errors stay in reach of the thumb. */
export default function StickyBar({ children, error, onErrorClick }: StickyBarProps) {
  return (
    <div className="stickybar">
      {error && (
        <div role="alert">
          {onErrorClick ? (
            <button type="button" className="stickybar-err" onClick={onErrorClick}>
              {error}
            </button>
          ) : (
            <p className="stickybar-err">{error}</p>
          )}
        </div>
      )}
      <div className="stickybar-row">{children}</div>
    </div>
  );
}
