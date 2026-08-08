import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatINR } from '../lib/format';
import type { AdminProduct } from '../lib/types';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';
import { useToast } from '../components/Toast';

const totalStock = (p: AdminProduct) => p.variants.reduce((sum, v) => sum + v.stock, 0);

interface BulkDeleteResponse {
  results: { id: string; outcome: 'deleted' | 'archived' | 'not_found' }[];
}

export default function Products() {
  const navigate = useNavigate();
  const toast = useToast();
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let live = true;
    api<AdminProduct[]>('/api/admin/products')
      .then((data) => live && setProducts(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  const collections = useMemo(
    () => [...new Set((products ?? []).map((p) => p.collection).filter(Boolean))].sort(),
    [products],
  );

  const visible = useMemo(
    () =>
      collectionFilter === 'all'
        ? products ?? []
        : (products ?? []).filter((p) => p.collection === collectionFilter),
    [products, collectionFilter],
  );

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
    if (ids.length === 0 || deleting) return;
    const noun = ids.length === 1 ? 'piece' : 'pieces';
    if (!window.confirm(`Delete ${ids.length} ${noun}? Pieces with past orders are archived instead of deleted.`)) {
      return;
    }
    setDeleting(true);
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
      setDeleting(false);
    }
  };

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
    { key: 'name', label: 'Piece', render: (p) => <span className="nm">{p.name}</span> },
    { key: 'category', label: 'Category', render: (p) => p.categoryName },
    {
      key: 'collection',
      label: 'Collection',
      render: (p) => (p.collection ? p.collection : <span className="dim">—</span>),
    },
    { key: 'price', label: 'Price', align: 'right', render: (p) => formatINR(p.price) },
    {
      key: 'flag',
      label: 'Flag',
      render: (p) =>
        p.flag ? (
          <span className="badge crafting">{p.flag === 'bestseller' ? 'Bestseller' : 'New'}</span>
        ) : (
          <span className="dim">—</span>
        ),
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
  ];

  return (
    <>
      <div className="head-row">
        <div className="page-head-admin">
          <span className="eyebrow">Inventory</span>
          <h1>Products</h1>
        </div>
        {selected.size > 0 ? (
          <button className="btn-outline fit" type="button" disabled={deleting} onClick={() => void deleteSelected()}>
            {deleting ? 'Deleting…' : `Delete selected (${selected.size})`}
          </button>
        ) : (
          <button className="btn-buy gold fit" type="button" onClick={() => navigate('/products/new')}>
            New Piece
          </button>
        )}
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
