import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDate, formatINR } from '../lib/format';
import type { LedgerEntry } from '../lib/types';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';

const MODE_LABELS: Record<string, string> = { cash: 'Cash', online: 'Online' };

const columns: Column<LedgerEntry>[] = [
  {
    key: 'source',
    label: 'Source',
    render: (p) =>
      p.source === 'manual' ? (
        <span className="badge crafting">Manual</span>
      ) : (
        <span className="badge muted">Gateway</span>
      ),
  },
  { key: 'order', label: 'Order', render: (p) => p.orderNumber || p.orderId },
  {
    key: 'details',
    label: 'Details',
    render: (p) => (
      <span className="dim">
        {p.source === 'gateway'
          ? [p.providerOrderId, p.providerPaymentId].filter(Boolean).join(' · ') || '—'
          : p.note || '—'}
      </span>
    ),
  },
  { key: 'amount', label: 'Amount', align: 'right', render: (p) => formatINR(p.amount) },
  { key: 'mode', label: 'Mode', render: (p) => MODE_LABELS[p.mode] ?? p.mode },
  { key: 'status', label: 'Status', render: (p) => <StatusBadge status={p.status} /> },
  { key: 'date', label: 'Date', render: (p) => formatDate(p.date) },
];

export default function Payments() {
  const [entries, setEntries] = useState<LedgerEntry[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<LedgerEntry[]>('/api/admin/payments')
      .then((data) => live && setEntries(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  const total = (entries ?? [])
    .filter((p) => p.source === 'manual' || p.status === 'captured')
    .reduce((sum, p) => sum + p.amount, 0);

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The Ledger</span>
        <h1>Payments</h1>
      </div>

      {error && <p className="state-note">{error}</p>}
      {!entries && !error && <p className="state-note">Loading payments…</p>}
      {entries && (
        <>
          {entries.length > 0 && (
            <p className="state-note">
              {entries.length} {entries.length === 1 ? 'entry' : 'entries'} · {formatINR(total)}{' '}
              received
            </p>
          )}
          <DataTable
            columns={columns}
            rows={entries}
            rowKey={(p) => `${p.source}-${p.id}`}
            empty="No payments recorded yet."
          />
        </>
      )}
    </>
  );
}
