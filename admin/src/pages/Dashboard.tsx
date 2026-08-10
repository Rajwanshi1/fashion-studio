import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, formatINR } from '../lib/format';
import type { AdminSummary, LowStockItem, Order } from '../lib/types';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';

const LOW_STOCK_CAP = 10;

const lowStockColumns: Column<LowStockItem>[] = [
  {
    key: 'photo',
    label: 'Photo',
    render: (r) =>
      r.imageUrl ? (
        <span className="thumbs">
          <img src={r.imageUrl} alt="" loading="lazy" width={34} height={44} />
        </span>
      ) : (
        <span className="dim">—</span>
      ),
  },
  { key: 'product', label: 'Piece', render: (r) => <span className="nm">{r.productName}</span> },
  {
    key: 'color',
    label: 'Colour',
    render: (r) => r.color || <span className="dim">—</span>,
  },
  {
    key: 'edit',
    label: 'Restock',
    render: (r) => (
      <Link className="ulink" to={`/products/${r.productId}`}>
        Open piece
      </Link>
    ),
  },
];

const recentOrderColumns: Column<Order>[] = [
  { key: 'number', label: 'Order', render: (o) => o.orderNumber },
  { key: 'date', label: 'Placed', render: (o) => formatDate(o.createdAt) },
  {
    key: 'customer',
    label: 'Customer',
    render: (o) => `${o.firstName} ${o.lastName}`,
  },
  { key: 'total', label: 'Total', align: 'right', render: (o) => formatINR(o.total) },
  { key: 'status', label: 'Status', render: (o) => <StatusBadge status={o.status} /> },
];

export default function Dashboard() {
  const [summary, setSummary] = useState<AdminSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<AdminSummary>('/api/admin/summary')
      .then((data) => live && setSummary(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The Atelier Desk</span>
        <h1>Dashboard</h1>
      </div>

      {error && <p className="state-note">{error}</p>}
      {!summary && !error && <p className="state-note">Loading the atelier ledger…</p>}

      {summary && (
        <>
          <div className="stats">
            <StatCard label="Active Orders" value={summary.activeOrders} hint="In progress" />
            <StatCard
              label="Collected"
              value={formatINR(summary.revenue)}
              hint="Money received to date"
            />
            <StatCard
              label="To Collect"
              value={formatINR(summary.pendingToCollect)}
              hint={`${summary.pendingPayments} ${summary.pendingPayments === 1 ? 'order' : 'orders'} with balance due`}
            />
            <StatCard
              label="Out of Stock"
              value={summary.lowStock.length}
              hint="Pieces with no sizes left"
            />
          </div>

          <p className="section-label">Out of stock</p>
          <DataTable
            columns={lowStockColumns}
            rows={summary.lowStock.slice(0, LOW_STOCK_CAP)}
            rowKey={(r) => r.productId}
            empty="Every piece is in stock."
          />
          {summary.lowStock.length > LOW_STOCK_CAP && (
            <p className="state-note">
              …and {summary.lowStock.length - LOW_STOCK_CAP} more — see{' '}
              <Link className="ulink" to="/products">
                Products
              </Link>
              .
            </p>
          )}

          <p className="section-label">Recent orders</p>
          <DataTable
            columns={recentOrderColumns}
            rows={summary.recentOrders}
            rowKey={(o) => o.id}
            empty="No orders yet."
          />
          <p className="state-note">
            <Link to="/orders" className="btn-line btn">
              View All Orders
            </Link>
          </p>
        </>
      )}
    </>
  );
}
