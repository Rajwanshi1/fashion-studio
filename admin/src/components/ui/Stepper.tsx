interface StepperProps {
  id: string;
  /** Form state keeps strings; the stepper clamps to integers on blur/step. */
  value: string;
  onChange: (next: string) => void;
  min?: number;
  max?: number;
  /** Names the −/+ buttons for assistive tech, e.g. "quantity". */
  label: string;
}

/** −/+ integer input — counts (qty, stock) never need the keyboard at all. */
export default function Stepper({ id, value, onChange, min = 0, max, label }: StepperProps) {
  const num = Math.round(Number(value) || 0);
  const clamp = (n: number) => Math.min(max ?? Infinity, Math.max(min, n));
  const stepBy = (d: number) => onChange(String(clamp(num + d)));

  return (
    <div className="stepper">
      <button
        type="button"
        className="step-btn"
        aria-label={`Decrease ${label}`}
        disabled={num <= min}
        onClick={() => stepBy(-1)}
      >
        −
      </button>
      <input
        id={id}
        className="inp step-inp"
        inputMode="numeric"
        pattern="[0-9]*"
        value={value}
        onChange={(e) => onChange(e.target.value.replace(/[^0-9]/g, ''))}
        onBlur={() => onChange(String(clamp(num)))}
      />
      <button
        type="button"
        className="step-btn"
        aria-label={`Increase ${label}`}
        disabled={max != null && num >= max}
        onClick={() => stepBy(1)}
      >
        +
      </button>
    </div>
  );
}
