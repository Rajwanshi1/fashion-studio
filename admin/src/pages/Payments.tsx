import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDate, formatINR } from '../lib/format';
import type { Payment } from '../lib/types';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import { Skeleton } from '../components/ui';

const columns: Column<Payment>[] = [
  { key: 'id', label: 'Payment', render: (p) => <span className="dim">{p.id}</span> },
  { key: 'order', label: 'Order', render: (p) => p.orderNumber ?? p.orderId },
  {
    key: 'provider',
    label: 'Provider IDs',
    render: (p) => (
      <span className="dim">
        {p.providerOrderId}
        {p.providerPaymentId ? ` · ${p.providerPaymentId}` : ''}
      </span>
    ),
  },
  { key: 'amount', label: 'Amount', align: 'right', render: (p) => formatINR(p.amount) },
  { key: 'method', label: 'Method', render: (p) => p.method },
  { key: 'status', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
  { key: 'date', label: 'Date', render: (p) => formatDate(p.createdAt) },
];

export default function Payments() {
  const [payments, setPayments] = useState<Payment[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<Payment[]>('/api/admin/payments')
      .then((data) => live && setPayments(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The Ledger</span>
        <h1>Payments</h1>
      </div>

      {error && <p className="state-note">{error}</p>}
      {!payments && !error && <Skeleton variant="rows" />}
      {payments && (
        <DataTable
          columns={columns}
          rows={payments}
          rowKey={(p) => p.id}
          empty="No payments recorded yet."
        />
      )}
    </>
  );
}
