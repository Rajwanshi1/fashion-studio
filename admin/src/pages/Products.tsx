import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatINR } from '../lib/format';
import type { AdminProduct } from '../lib/types';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';

const totalStock = (p: AdminProduct) => p.variants.reduce((sum, v) => sum + v.stock, 0);

const columns: Column<AdminProduct>[] = [
  { key: 'name', label: 'Piece', render: (p) => <span className="nm">{p.name}</span> },
  { key: 'category', label: 'Category', render: (p) => p.categoryName },
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

export default function Products() {
  const navigate = useNavigate();
  const [products, setProducts] = useState<AdminProduct[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<AdminProduct[]>('/api/admin/products')
      .then((data) => live && setProducts(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

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

      {error && <p className="state-note">{error}</p>}
      {!products && !error && <p className="state-note">Loading pieces…</p>}
      {products && (
        <DataTable
          columns={columns}
          rows={products}
          rowKey={(p) => p.id}
          empty="No pieces in the collection yet."
          onRowClick={(p) => navigate(`/products/${p.id}`)}
        />
      )}
    </>
  );
}
