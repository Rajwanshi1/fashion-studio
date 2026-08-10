import { useMemo, useState } from 'react';
import { formatINR } from '../lib/format';
import { effectivePrice } from '../lib/productFilter';
import type { AdminProduct } from '../lib/types';

export interface PickedItem {
  productId: string;
  variantId: string;
  description: string;
  unitRupees: string;
  size: string;
  stock: number;
}

interface Props {
  products: AdminProduct[];
  onPick: (item: PickedItem) => void;
}

/**
 * Search-and-pick against the catalogue for order lines: choosing a size
 * fills the row and links it, so the sale decrements stock. Freeform entry
 * stays available for bespoke work.
 */
export default function ProductPicker({ products, onPick }: Props) {
  const [query, setQuery] = useState('');
  const [openId, setOpenId] = useState<string | null>(null);

  const matches = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (q.length < 2) return [];
    return products
      .filter((p) =>
        [p.name, p.color, p.collection]
          .filter(Boolean)
          .some((field) => field.toLowerCase().includes(q)),
      )
      .slice(0, 6);
  }, [products, query]);

  const pick = (p: AdminProduct, variantId: string, size: string, stock: number) => {
    onPick({
      productId: p.id,
      variantId,
      description: `${p.name}${p.color ? ` — ${p.color}` : ''} (${size})`,
      unitRupees: String(effectivePrice(p) / 100),
      size,
      stock,
    });
    setQuery('');
    setOpenId(null);
  };

  return (
    <div className="picker">
      <div className="field">
        <label className="lab" htmlFor="oi-picker">
          Add from the catalogue
        </label>
        <input
          id="oi-picker"
          className="inp"
          placeholder="Search by name, colour or collection…"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpenId(null);
          }}
        />
      </div>
      {matches.length > 0 && (
        <ul className="picker-list">
          {matches.map((p) => (
            <li key={p.id} className="picker-item">
              <button
                type="button"
                className="picker-row"
                aria-expanded={openId === p.id}
                onClick={() => setOpenId((cur) => (cur === p.id ? null : p.id))}
              >
                <span className="nm">{p.name}</span>
                <span className="dim">
                  {[p.color, p.collection].filter(Boolean).join(' · ') || '—'}
                </span>
                <span>{formatINR(effectivePrice(p))}</span>
              </button>
              {openId === p.id && (
                <div className="chips picker-sizes" role="group" aria-label={`Sizes for ${p.name}`}>
                  {p.variants.map((v) => (
                    <button
                      key={v.id}
                      type="button"
                      className="chip"
                      disabled={v.stock <= 0}
                      title={v.stock <= 0 ? 'Out of stock — record it as a custom line instead' : undefined}
                      onClick={() => pick(p, v.id, v.size, v.stock)}
                    >
                      {v.size} · {v.stock} in stock
                    </button>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
      {query.trim().length >= 2 && matches.length === 0 && (
        <p className="x">No pieces match — use a freeform line below for bespoke work.</p>
      )}
    </div>
  );
}
