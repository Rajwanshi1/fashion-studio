import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatINR } from '../lib/format';
import { productUrl } from '../lib/shop';
import type { AdminProduct } from '../lib/types';
import type { ProductFilters } from '../lib/productFilter';
import { EMPTY_FILTERS, applyProductFilters } from '../lib/productFilter';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';
import ProductBulkBar from '../components/ProductBulkBar';
import ProductFiltersBar from '../components/ProductFilters';
import { useToast } from '../components/Toast';

const totalStock = (p: AdminProduct) => p.variants.reduce((sum, v) => sum + v.stock, 0);

const FLAG_LABELS = { bestseller: 'Bestseller', new: 'New', sale: 'Sale' } as const;

/** Mirrors the backend's bulk action union (backend/src/data/products.repo.ts). */
type BulkAction =
  | { type: 'sale'; discountPct: number }
  | { type: 'end_sale' }
  | { type: 'visibility'; active: boolean }
  | { type: 'flag'; flag: 'new' | 'bestseller' | null };

interface BulkDeleteResponse {
  results: { id: string; outcome: 'deleted' | 'archived' | 'not_found' }[];
}

interface BulkUpdateResponse {
  results: { id: string; outcome: 'updated' | 'skipped' | 'not_found' }[];
}

const pieces = (n: number) => (n === 1 ? 'piece' : 'pieces');

/** The gallery to preview in the table: real photos, else the legacy single image. */
function thumbnails(p: AdminProduct): string[] {
  const gallery = p.images?.length ? p.images.map((i) => i.url) : p.imageUrl ? [p.imageUrl] : [];
  return gallery.slice(0, 3);
}

export default function Products() {
  const navigate = useNavigate();
  const toast = useToast();
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [filters, setFilters] = useState<ProductFilters>(EMPTY_FILTERS);
  const [busy, setBusy] = useState(false);

  const load = useCallback(async () => {
    try {
      setProducts(await api<AdminProduct[]>('/api/admin/products'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to load pieces');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const all = products ?? [];

  const collections = useMemo(
    () => [...new Set(all.map((p) => p.collection).filter(Boolean))].sort(),
    [all],
  );

  const visible = useMemo(() => {
    const byCollection =
      collectionFilter === 'all' ? all : all.filter((p) => p.collection === collectionFilter);
    return applyProductFilters(byCollection, filters);
  }, [all, collectionFilter, filters]);

  const allVisibleSelected = visible.length > 0 && visible.every((p) => selected.has(p.id));

  const toggle = (id: string) =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  const toggleAll = () =>
    setSelected((prev) => {
      if (allVisibleSelected) {
        const next = new Set(prev);
        for (const p of visible) next.delete(p.id);
        return next;
      }
      return new Set([...prev, ...visible.map((p) => p.id)]);
    });

  const deleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0 || busy) return;
    if (!window.confirm(`Delete ${ids.length} ${pieces(ids.length)}? Pieces with past orders are archived instead of deleted.`)) {
      return;
    }
    setBusy(true);
    try {
      const { results } = await api<BulkDeleteResponse>('/api/admin/products/bulk-delete', {
        method: 'POST',
        body: { ids },
      });
      const deleted = results.filter((r) => r.outcome === 'deleted').length;
      const archived = results.filter((r) => r.outcome === 'archived').length;
      const gone = new Set(results.filter((r) => r.outcome !== 'not_found').map((r) => r.id));
      setProducts((prev) => (prev ? prev.filter((p) => !gone.has(p.id)) : prev));
      setSelected(new Set());
      const parts = [];
      if (deleted) parts.push(`${deleted} deleted`);
      if (archived) parts.push(`${archived} archived (has orders)`);
      toast(parts.length ? parts.join(' · ') : 'Nothing to delete');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to delete', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  /**
   * Every non-delete bulk edit goes through here. The server recomputes sale
   * prices from each piece's own price, so the list is refetched rather than
   * patched — the table can only be trusted if it shows what was actually saved.
   */
  const applyBulk = async (action: BulkAction, confirmText: string, doneVerb: string) => {
    const ids = [...selected];
    if (ids.length === 0 || busy) return;
    if (!window.confirm(confirmText)) return;
    setBusy(true);
    try {
      const { results } = await api<BulkUpdateResponse>('/api/admin/products/bulk-update', {
        method: 'POST',
        body: { ids, action },
      });
      const updated = results.filter((r) => r.outcome === 'updated').length;
      const untouched = results.length - updated;
      await load();
      setSelected(new Set());
      const parts = [`${updated} ${doneVerb}`];
      if (untouched) parts.push(`${untouched} unchanged`);
      toast(parts.join(' · '));
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to update', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  const n = selected.size;

  const putOnSale = (discountPct: number) =>
    applyBulk(
      { type: 'sale', discountPct },
      `Put ${n} ${pieces(n)} on sale at ${discountPct}% off? Each piece is discounted from its own price.`,
      'on sale',
    );

  const endSale = () =>
    applyBulk({ type: 'end_sale' }, `End the sale on ${n} ${pieces(n)}?`, 'back to full price');

  const setVisibility = (active: boolean) =>
    applyBulk(
      { type: 'visibility', active },
      active
        ? `Show ${n} ${pieces(n)} on the storefront?`
        : `Hide ${n} ${pieces(n)} from the storefront?`,
      active ? 'shown' : 'hidden',
    );

  const setFlag = (flag: 'new' | 'bestseller' | null) =>
    applyBulk(
      { type: 'flag', flag },
      flag
        ? `Flag ${n} ${pieces(n)} as ${FLAG_LABELS[flag]}? Any sale price is cleared.`
        : `Clear the flag on ${n} ${pieces(n)}? Any sale price is cleared.`,
      'flagged',
    );

  const columns: Column<AdminProduct>[] = [
    {
      key: 'select',
      label: (
        <input
          type="checkbox"
          className="check"
          aria-label="Select all pieces"
          checked={allVisibleSelected}
          onChange={toggleAll}
        />
      ),
      render: (p) => (
        <input
          type="checkbox"
          className="check"
          aria-label={`Select ${p.name}`}
          checked={selected.has(p.id)}
          onClick={(e) => e.stopPropagation()}
          onChange={() => toggle(p.id)}
        />
      ),
    },
    {
      key: 'photos',
      label: 'Photos',
      render: (p) => {
        const urls = thumbnails(p);
        if (urls.length === 0) return <span className="dim">—</span>;
        return (
          <span className="thumbs">
            {urls.map((url, i) => (
              <img key={`${url}-${i}`} src={url} alt="" loading="lazy" />
            ))}
          </span>
        );
      },
    },
    { key: 'name', label: 'Piece', render: (p) => <span className="nm">{p.name}</span> },
    { key: 'category', label: 'Category', render: (p) => p.categoryName },
    {
      key: 'collection',
      label: 'Collection',
      render: (p) => (p.collection ? p.collection : <span className="dim">—</span>),
    },
    { key: 'color', label: 'Colour', render: (p) => p.color || <span className="dim">—</span> },
    { key: 'fabric', label: 'Fabric', render: (p) => p.fabric || <span className="dim">—</span> },
    {
      key: 'price',
      label: 'Price',
      align: 'right',
      render: (p) => {
        const sale = p.flag === 'sale' && p.salePrice != null ? p.salePrice : null;
        if (sale === null) return formatINR(p.price);
        return (
          <>
            <span className="was">{formatINR(p.price)}</span>
            {formatINR(sale)}
            <span className="off">−{Math.round((1 - sale / p.price) * 100)}%</span>
          </>
        );
      },
    },
    {
      key: 'flag',
      label: 'Flag',
      render: (p) =>
        p.flag ? <span className="badge crafting">{FLAG_LABELS[p.flag]}</span> : <span className="dim">—</span>,
    },
    {
      key: 'active',
      label: 'Visibility',
      render: (p) =>
        p.active ? (
          <span className="badge paid">Active</span>
        ) : (
          <span className="badge muted">Hidden</span>
        ),
    },
    { key: 'stock', label: 'Total Stock', align: 'right', render: (p) => totalStock(p) },
    {
      key: 'live',
      label: 'Live page',
      // Hidden pieces 404 on the storefront (catalog.service.ts), so linking
      // them would only ever lead somewhere broken.
      render: (p) =>
        p.active ? (
          <a
            className="ulink"
            href={productUrl(p.slug)}
            target="_blank"
            rel="noopener noreferrer"
            onClick={(e) => e.stopPropagation()}
          >
            View ↗
          </a>
        ) : (
          <span className="dim">Not live</span>
        ),
    },
  ];

  return (
    <>
      <div className="head-row">
        <div className="page-head-admin">
          <span className="eyebrow">Inventory</span>
          <h1>Products</h1>
        </div>
        <button className="btn-buy gold fit" type="button" onClick={() => navigate('/products/new')}>
          New Piece
        </button>
      </div>

      {collections.length > 0 && (
        <div className="chips" role="group" aria-label="Filter by collection">
          <button
            type="button"
            className={collectionFilter === 'all' ? 'chip on' : 'chip'}
            onClick={() => setCollectionFilter('all')}
          >
            All
          </button>
          {collections.map((name) => (
            <button
              key={name}
              type="button"
              className={collectionFilter === name ? 'chip on' : 'chip'}
              onClick={() => setCollectionFilter(name)}
            >
              {name}
            </button>
          ))}
        </div>
      )}

      {products && (
        <ProductFiltersBar
          products={all}
          filters={filters}
          onChange={setFilters}
          shown={visible.length}
          total={all.length}
        />
      )}

      {selected.size > 0 && (
        <ProductBulkBar
          count={selected.size}
          busy={busy}
          onClear={() => setSelected(new Set())}
          onSale={(pct) => void putOnSale(pct)}
          onEndSale={() => void endSale()}
          onVisibility={(active) => void setVisibility(active)}
          onFlag={(flag) => void setFlag(flag)}
          onDelete={() => void deleteSelected()}
        />
      )}

      {error && <p className="state-note">{error}</p>}
      {!products && !error && <p className="state-note">Loading pieces…</p>}
      {products && (
        <DataTable
          columns={columns}
          rows={visible}
          rowKey={(p) => p.id}
          empty="No pieces in the collection yet."
          onRowClick={(p) => navigate(`/products/${p.id}`)}
        />
      )}
    </>
  );
}
