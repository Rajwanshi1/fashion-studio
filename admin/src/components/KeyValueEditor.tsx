export interface KeyValueRow {
  name: string;
  value: string;
}

/** One measurement set as edited in the order form (values verbatim, e.g. "38½"). */
export interface MeasurementSetState {
  label: string;
  rows: KeyValueRow[];
  notes: string;
  /** Uploaded measurement-page photo this set came from, if any. */
  documentId: string | null;
}

export const EMPTY_SET: MeasurementSetState = { label: '', rows: [{ name: '', value: '' }], notes: '', documentId: null };

interface Props {
  /** Unique per set — keeps input ids/labels distinct across sets. */
  idPrefix: string;
  set: MeasurementSetState;
  onChange: (next: MeasurementSetState) => void;
  onRemove: () => void;
}

/** Free-form name/value rows for a measurement set: label + rows + add/remove. */
export default function KeyValueEditor({ idPrefix, set, onChange, onRemove }: Props) {
  const setRow = (index: number, key: keyof KeyValueRow, value: string) =>
    onChange({ ...set, rows: set.rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)) });

  return (
    <div className="mset">
      <div className="mset-head">
        <div className="field">
          <label className="lab" htmlFor={`${idPrefix}-label`}>
            Set Label
          </label>
          <input
            id={`${idPrefix}-label`}
            className="inp"
            placeholder="e.g. Blouse — Meera"
            value={set.label}
            onChange={(e) => onChange({ ...set, label: e.target.value })}
          />
        </div>
        <button type="button" className="btn-outline fit" onClick={onRemove}>
          Remove set
        </button>
      </div>
      {set.rows.map((row, i) => (
        <div className="kv-row" key={i}>
          <input
            className="inp"
            aria-label={`Measurement ${i + 1} name`}
            placeholder="SH"
            value={row.name}
            onChange={(e) => setRow(i, 'name', e.target.value)}
          />
          <input
            className="inp"
            aria-label={`Measurement ${i + 1} value`}
            placeholder='15 in'
            value={row.value}
            onChange={(e) => setRow(i, 'value', e.target.value)}
          />
          <button
            type="button"
            className="btn-outline fit"
            aria-label={`Remove measurement ${i + 1}`}
            onClick={() => onChange({ ...set, rows: set.rows.filter((_, x) => x !== i) })}
          >
            ✕
          </button>
        </div>
      ))}
      <button
        type="button"
        className="btn-outline fit"
        onClick={() => onChange({ ...set, rows: [...set.rows, { name: '', value: '' }] })}
      >
        + Add measurement
      </button>
      <div className="field">
        <label className="lab" htmlFor={`${idPrefix}-notes`}>
          Set Notes
        </label>
        <input
          id={`${idPrefix}-notes`}
          className="inp"
          value={set.notes}
          onChange={(e) => onChange({ ...set, notes: e.target.value })}
        />
      </div>
    </div>
  );
}
