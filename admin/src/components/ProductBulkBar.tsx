import { useState } from 'react';

/** Flags this bar can set. 'sale' isn't here — a sale needs a percentage. */
type SettableFlag = 'new' | 'bestseller' | '';

interface Props {
  count: number;
  busy: boolean;
  onClear: () => void;
  onSale: (discountPct: number) => void;
  onEndSale: () => void;
  onVisibility: (active: boolean) => void;
  onFlag: (flag: 'new' | 'bestseller' | null) => void;
  onDelete: () => void;
}

/** Matches the backend's bulk-update schema, which refuses anything outside it. */
const MIN_PCT = 1;
const MAX_PCT = 95;

export default function ProductBulkBar({
  count,
  busy,
  onClear,
  onSale,
  onEndSale,
  onVisibility,
  onFlag,
  onDelete,
}: Props) {
  const [pct, setPct] = useState('');
  const [flag, setFlag] = useState<SettableFlag>('');

  const discount = Number(pct);
  const pctValid =
    pct.trim() !== '' && Number.isInteger(discount) && discount >= MIN_PCT && discount <= MAX_PCT;

  return (
    <div className="bulk-bar" role="group" aria-label="Actions for selected pieces">
      <span className="bulk-count">{count} selected</span>
      <button className="ulink" type="button" onClick={onClear} disabled={busy}>
        Clear
      </button>

      <div className="bulk-group">
        <label className="lab" htmlFor="bulk-pct">
          Discount %
        </label>
        <input
          id="bulk-pct"
          className="inp narrow"
          type="number"
          min={MIN_PCT}
          max={MAX_PCT}
          inputMode="numeric"
          value={pct}
          onChange={(e) => setPct(e.target.value)}
        />
        <button
          className="btn-outline fit"
          type="button"
          disabled={busy || !pctValid}
          onClick={() => onSale(discount)}
        >
          Put on sale
        </button>
        <button className="btn-outline fit" type="button" disabled={busy} onClick={onEndSale}>
          End sale
        </button>
      </div>

      <div className="bulk-group">
        <button
          className="btn-outline fit"
          type="button"
          disabled={busy}
          onClick={() => onVisibility(true)}
        >
          Show
        </button>
        <button
          className="btn-outline fit"
          type="button"
          disabled={busy}
          onClick={() => onVisibility(false)}
        >
          Hide
        </button>
      </div>

      <div className="bulk-group">
        <label className="lab" htmlFor="bulk-flag">
          Set flag
        </label>
        <select
          id="bulk-flag"
          className="inp"
          value={flag}
          onChange={(e) => setFlag(e.target.value as SettableFlag)}
        >
          <option value="">No flag</option>
          <option value="new">New</option>
          <option value="bestseller">Bestseller</option>
        </select>
        <button
          className="btn-outline fit"
          type="button"
          disabled={busy}
          onClick={() => onFlag(flag === '' ? null : flag)}
        >
          Apply flag
        </button>
      </div>

      <button className="btn-outline fit danger" type="button" disabled={busy} onClick={onDelete}>
        Delete
      </button>
    </div>
  );
}
