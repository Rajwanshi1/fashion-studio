import { useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatINR } from '../lib/format';
import { useListSearch } from '../lib/pageChrome';
import type { AdminProduct } from '../lib/types';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';
import ListSearch from '../components/shell/ListSearch';
import { useToast } from '../components/Toast';
import { Button, Sheet } from '../components/ui';

const totalStock = (p: AdminProduct) => p.variants.reduce((sum, v) => sum + v.stock, 0);

interface BulkDeleteResponse {
  results: { id: string; outcome: 'deleted' | 'archived' | 'not_found' }[];
}

/** Case-insensitive match on the piece name, its collection or its category. */
function matchesQuery(product: AdminProduct, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return [product.name, product.collection, product.categoryName].some((field) =>
    (field ?? '').toLowerCase().includes(needle),
  );
}

export default function Products() {
  const navigate = useNavigate();
  const toast = useToast();
  const [query] = useListSearch('Search pieces…');
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [collectionFilter, setCollectionFilter] = useState('all');
  const [confirmOpen, setConfirmOpen] = useState(false);
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
      (products ?? []).filter(
        (p) =>
          (collectionFilter === 'all' || p.collection === collectionFilter) &&
          matchesQuery(p, query),
      ),
    [products, collectionFilter, query],
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

  const selectedProducts = (products ?? []).filter((p) => selected.has(p.id));
  const noun = selected.size === 1 ? 'piece' : 'pieces';

  const deleteSelected = async () => {
    const ids = [...selected];
    if (ids.length === 0 || deleting) return;
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
      setConfirmOpen(false);
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
      dataLabel: 'Select',
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
        <div className="head-tools">
          <ListSearch placeholder="Search pieces…" />
          {selected.size > 0 ? (
            <Button fit disabled={deleting} onClick={() => setConfirmOpen(true)}>
              {`Delete selected (${selected.size})`}
            </Button>
          ) : (
            <Button variant="gold" fit onClick={() => navigate('/products/new')}>
              New Piece
            </Button>
          )}
        </div>
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

      <Sheet
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title={`Delete ${selected.size} ${noun}?`}
        footer={
          <div className="sheet-actions">
            <Button variant="gold" busy={deleting} onClick={() => void deleteSelected()}>
              {deleting ? 'Deleting…' : 'Delete'}
            </Button>
            <Button onClick={() => setConfirmOpen(false)}>Cancel</Button>
          </div>
        }
      >
        <p className="x">
          {selectedProducts
            .slice(0, 3)
            .map((p) => p.name)
            .join(', ')}
          {selectedProducts.length > 3 && ` and ${selectedProducts.length - 3} more`}
        </p>
        <p className="x">Pieces with past orders are archived instead of deleted.</p>
      </Sheet>
    </>
  );
}
