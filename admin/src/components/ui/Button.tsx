import type { ButtonHTMLAttributes } from 'react';

type Variant = 'primary' | 'gold' | 'outline' | 'ghost';

/** Maps onto the existing admin button classes so the look stays identical. */
const CLASSES: Record<Variant, string> = {
  primary: 'btn-buy',
  gold: 'btn-buy gold',
  outline: 'btn-outline',
  ghost: 'ulink',
};

interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant;
  /** Shrink-to-content width (block-level full width otherwise). */
  fit?: boolean;
  /** In-flight state: disables the button and flags it for assistive tech. */
  busy?: boolean;
}

export default function Button({
  variant = 'outline',
  fit,
  busy,
  className,
  disabled,
  type,
  children,
  ...rest
}: ButtonProps) {
  const cls = [CLASSES[variant], fit && variant !== 'ghost' ? 'fit' : '', className]
    .filter(Boolean)
    .join(' ');
  return (
    <button
      type={type ?? 'button'}
      className={cls}
      disabled={disabled || busy}
      aria-busy={busy || undefined}
      {...rest}
    >
      {children}
    </button>
  );
}
