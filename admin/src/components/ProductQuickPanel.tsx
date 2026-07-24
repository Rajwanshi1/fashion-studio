import { useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import type { AdminProduct } from '../lib/types';
import { useToast } from './Toast';

interface Props {
  product: AdminProduct;
  onSaved: (product: AdminProduct) => void;
}

const toStock = (raw: string | undefined) => Math.max(0, Math.round(Number(raw) || 0));

export default function ProductQuickPanel({ product, onSaved }: Props) {
  const toast = useToast();
  const [stocks, setStocks] = useState<Record<string, string>>(() =>
    Object.fromEntries(product.variants.map((v) => [v.id, String(v.stock)])),
  );
  const [active, setActive] = useState(product.active);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const onSave = async () => {
    setError(null);
    const updates = product.variants
      .filter((v) => toStock(stocks[v.id]) !== v.stock)
      .map((v) => ({ variantId: v.id, stock: toStock(stocks[v.id]) }));
    const activeChanged = active !== product.active;
    if (updates.length === 0 && !activeChanged) return;

    setBusy(true);
    try {
      let updated = product;
      if (updates.length > 0) {
        updated = await api<AdminProduct>(`/api/admin/products/${product.id}/variants`, {
          method: 'PATCH',
          body: { updates },
        });
      }
      if (activeChanged) {
        updated = await api<AdminProduct>(`/api/admin/products/${product.id}`, {
          method: 'PUT',
          body: { active },
        });
      }
      onSaved(updated);
      toast('Saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save');
    }
    setBusy(false);
  };

  return (
    <div className="quick-panel">
      {error && (
        <div className="form-err" role="alert">
          {error}
        </div>
      )}

      <div className="variants-grid">
        {product.variants.map((v) => (
          <div className="field" key={v.id}>
            <label className="lab" htmlFor={`qp-stock-${v.id}`}>
              {v.size}
            </label>
            <input
              id={`qp-stock-${v.id}`}
              className="inp"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={stocks[v.id] ?? '0'}
              onChange={(e) => setStocks((s) => ({ ...s, [v.id]: e.target.value }))}
            />
          </div>
        ))}
      </div>

      <div className="quick-actions">
        <label className="check">
          <input type="checkbox" checked={active} onChange={(e) => setActive(e.target.checked)} />
          Visible in the boutique
        </label>
        <button className="btn-buy gold fit" type="button" disabled={busy} onClick={onSave}>
          {busy ? 'Saving…' : 'Save'}
        </button>
        <Link className="quick-link" to={`/products/${product.id}`}>
          Open full editor →
        </Link>
      </div>
    </div>
  );
}
