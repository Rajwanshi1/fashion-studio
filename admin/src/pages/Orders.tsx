import { useEffect, useMemo, useState } from 'react';
import { Navigate, useNavigate, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDate, formatINR } from '../lib/format';
import { useListSearch } from '../lib/pageChrome';
import { PHONE_QUERY, useMediaQuery } from '../lib/useMediaQuery';
import type { BillType, Order, OrderChannel, OrderStatus } from '../lib/types';
import {
  BILL_TYPE_LABELS,
  CHANNELS,
  CHANNEL_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
} from '../lib/types';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';
import ListSearch from '../components/shell/ListSearch';
import StatusBadge from '../components/StatusBadge';
import { Button, FilterChips, ListCard, Sheet, Skeleton } from '../components/ui';

type StatusFilter = 'all' | OrderStatus;
type ChannelFilter = 'all' | OrderChannel;
type BillFilter = 'all' | BillType;

const BILL_TYPES: BillType[] = ['gst_invoice', 'cash_memo'];

const STATUS_OPTIONS = [
  { value: 'all' as StatusFilter, label: 'All' },
  ...ORDER_STATUSES.map((s) => ({ value: s as StatusFilter, label: ORDER_STATUS_LABELS[s] })),
];
const CHANNEL_OPTIONS = [
  { value: 'all' as ChannelFilter, label: 'All' },
  ...CHANNELS.map((c) => ({ value: c as ChannelFilter, label: CHANNEL_LABELS[c] })),
];
const BILL_OPTIONS = [
  { value: 'all' as BillFilter, label: 'All' },
  ...BILL_TYPES.map((b) => ({ value: b as BillFilter, label: BILL_TYPE_LABELS[b] })),
];

const itemCount = (o: Order) => o.items.reduce((sum, it) => sum + it.quantity, 0);

const columns: Column<Order>[] = [
  { key: 'number', label: 'Order', render: (o) => o.orderNumber },
  { key: 'date', label: 'Placed', render: (o) => formatDate(o.createdAt) },
  { key: 'customer', label: 'Customer', render: (o) => `${o.firstName} ${o.lastName}` },
  { key: 'items', label: 'Items', align: 'right', render: (o) => itemCount(o) },
  { key: 'total', label: 'Total', align: 'right', render: (o) => formatINR(o.total) },
  { key: 'due', label: 'Due', render: (o) => o.deliveryDueDate ?? '—' },
  {
    key: 'balance',
    label: 'Balance',
    align: 'right',
    // Online orders settle through the payment gateway, not receipts — their
    // computed balance is not an amount owed, so only offline balances show.
    render: (o) => (o.channel !== 'online' && o.balance > 0 ? formatINR(o.balance) : '—'),
  },
  {
    key: 'status',
    label: 'Status',
    render: (o) => (
      <>
        <StatusBadge status={o.status} />
        {o.channel !== 'online' && <span className="badge muted">{CHANNEL_LABELS[o.channel]}</span>}
        {o.billType && <span className="badge muted">{BILL_TYPE_LABELS[o.billType]}</span>}
      </>
    ),
  },
];

/** Case-insensitive match on customer name, order number, or phone digits. */
function matchesQuery(order: Order, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const name = `${order.firstName} ${order.lastName}`.toLowerCase();
  if (name.includes(needle) || order.orderNumber.toLowerCase().includes(needle)) return true;
  const digits = needle.replace(/\D/g, '');
  return digits.length > 0 && order.phone.replace(/\D/g, '').includes(digits);
}

export default function Orders() {
  const navigate = useNavigate();
  const isPhone = useMediaQuery(PHONE_QUERY);
  const [query] = useListSearch('Search orders…');

  const [filter, setFilter] = useState<StatusFilter>('all');
  const [channel, setChannel] = useState<ChannelFilter>('all');
  const [billType, setBillType] = useState<BillFilter>('all');
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  // Legacy deep link from the scan-bill done screen — the order now has its own page.
  const [searchParams] = useSearchParams();
  const focusId = searchParams.get('focus');

  useEffect(() => {
    let live = true;
    setOrders(null);
    setError(null);
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('status', filter);
    if (channel !== 'all') params.set('channel', channel);
    if (billType !== 'all') params.set('billType', billType);
    const q = params.toString();
    api<Order[]>(`/api/admin/orders${q ? `?${q}` : ''}`)
      .then((data) => live && setOrders(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [filter, channel, billType]);

  const rows = useMemo(
    () => (orders ?? []).filter((o) => matchesQuery(o, query)),
    [orders, query],
  );

  if (focusId) return <Navigate to={`/orders/${focusId}`} replace />;

  const activeFilters = [filter, channel, billType].filter((v) => v !== 'all').length;
  const openOrder = (o: Order) => navigate(`/orders/${o.id}`, { state: { order: o } });

  return (
    <>
      <div className="head-row">
        <div className="page-head-admin">
          <span className="eyebrow">The Order Book</span>
          <h1>Orders</h1>
        </div>
        <div className="head-tools">
          <ListSearch placeholder="Search orders…" />
          <Button fit onClick={() => setFiltersOpen(true)}>
            {activeFilters > 0 ? `Filters · ${activeFilters}` : 'Filters'}
          </Button>
        </div>
      </div>

      <p className="section-label">{filter === 'all' ? 'All orders' : ORDER_STATUS_LABELS[filter]}</p>

      {error && <p className="state-note">{error}</p>}
      {!orders && !error && <Skeleton variant={isPhone ? 'cards' : 'rows'} count={4} label="Loading orders" />}

      {orders &&
        (isPhone ? (
          rows.length === 0 ? (
            <p className="state-note">No orders in this state.</p>
          ) : (
            rows.map((o) => (
              <ListCard
                key={o.id}
                primary={`${o.firstName} ${o.lastName}`.trim() || o.phone}
                secondary={`${o.orderNumber} · due ${o.deliveryDueDate ? formatDate(o.deliveryDueDate) : '—'}`}
                meta={formatINR(o.total)}
                badges={<StatusBadge status={o.status} />}
                ariaLabel={`Open order ${o.orderNumber}`}
                onClick={() => openOrder(o)}
              />
            ))
          )
        ) : (
          <DataTable
            columns={columns}
            rows={rows}
            rowKey={(o) => o.id}
            empty="No orders in this state."
            onRowClick={openOrder}
          />
        ))}

      <Sheet
        open={filtersOpen}
        onClose={() => setFiltersOpen(false)}
        title="Filters"
        footer={
          <Button variant="gold" onClick={() => setFiltersOpen(false)}>
            Done
          </Button>
        }
      >
        <p className="section-label filter-label">Status</p>
        <FilterChips label="Filter by status" options={STATUS_OPTIONS} value={filter} onChange={setFilter} />
        <p className="section-label filter-label">Channel</p>
        <FilterChips
          label="Filter by channel"
          options={CHANNEL_OPTIONS}
          value={channel}
          onChange={setChannel}
        />
        <p className="section-label filter-label">Bill type</p>
        <FilterChips
          label="Filter by bill type"
          options={BILL_OPTIONS}
          value={billType}
          onChange={setBillType}
        />
      </Sheet>
    </>
  );
}
