import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, formatINR } from '../lib/format';
import type { AdminSummary, LowStockItem, Order } from '../lib/types';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';

const lowStockColumns: Column<LowStockItem>[] = [
  { key: 'product', label: 'Piece', render: (r) => <span className="nm">{r.productName}</span> },
  { key: 'size', label: 'Size', render: (r) => r.size },
  { key: 'stock', label: 'Stock', align: 'right', render: (r) => r.stock },
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
              label="Low Stock"
              value={summary.lowStock.length}
              hint="Variants running out"
            />
          </div>

          <p className="section-label">Low stock</p>
          <DataTable
            columns={lowStockColumns}
            rows={summary.lowStock}
            rowKey={(r) => r.variantId}
            empty="Every piece is well stocked."
          />

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
