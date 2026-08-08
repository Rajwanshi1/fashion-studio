import type { ReactNode } from 'react';

export interface FieldA11y {
  id: string;
  'aria-invalid'?: boolean;
  'aria-describedby'?: string;
}

interface FieldProps {
  id: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: string | null;
  /** Render prop hands back the id + aria wiring so the label pairing can't drift. */
  children: (a11y: FieldA11y) => ReactNode;
}

export default function Field({ id, label, hint, error, children }: FieldProps) {
  const errId = error ? `${id}-err` : undefined;
  const hintId = hint && !error ? `${id}-hint` : undefined;
  return (
    <div className={error ? 'field invalid' : 'field'}>
      <label className="lab" htmlFor={id}>
        {label}
      </label>
      {children({
        id,
        'aria-invalid': error ? true : undefined,
        'aria-describedby': errId ?? hintId,
      })}
      {error && (
        <p className="field-err" id={errId}>
          {error}
        </p>
      )}
      {hint && !error && (
        <p className="field-hint" id={hintId}>
          {hint}
        </p>
      )}
    </div>
  );
}
