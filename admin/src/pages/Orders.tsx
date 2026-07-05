import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDate, formatINR } from '../lib/format';
import type { Order, OrderStatus } from '../lib/types';
import { ORDER_STATUSES, ORDER_STATUS_LABELS, ORDER_TRANSITIONS } from '../lib/types';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';

type Filter = 'all' | OrderStatus;

const itemCount = (o: Order) => o.items.reduce((sum, it) => sum + it.quantity, 0);

const columns: Column<Order>[] = [
  { key: 'number', label: 'Order', render: (o) => o.orderNumber },
  { key: 'date', label: 'Placed', render: (o) => formatDate(o.createdAt) },
  { key: 'customer', label: 'Customer', render: (o) => `${o.firstName} ${o.lastName}` },
  { key: 'items', label: 'Items', align: 'right', render: (o) => itemCount(o) },
  { key: 'total', label: 'Total', align: 'right', render: (o) => formatINR(o.total) },
  { key: 'status', label: 'Status', render: (o) => <StatusBadge status={o.status} /> },
];

export default function Orders() {
  const [filter, setFilter] = useState<Filter>('all');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let live = true;
    setOrders(null);
    setError(null);
    const query = filter === 'all' ? '' : `?status=${filter}`;
    api<Order[]>(`/api/admin/orders${query}`)
      .then((data) => live && setOrders(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [filter]);

  const moveOrder = async (order: Order, status: OrderStatus) => {
    try {
      await api<Order>(`/api/admin/orders/${order.id}`, {
        method: 'PATCH',
        body: { status },
      });
      setOrders((cur) =>
        cur ? cur.map((o) => (o.id === order.id ? { ...o, status } : o)) : cur,
      );
      toast(`Order ${order.orderNumber} → ${ORDER_STATUS_LABELS[status]}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to update order');
    }
  };

  const renderExpanded = (order: Order) => {
    const nexts = ORDER_TRANSITIONS[order.status];
    return (
      <div className="odetail">
        <div>
          <h4>Items</h4>
          {order.items.map((it) => (
            <div className="oitem" key={it.id}>
              <div>
                <div className="nm">{it.productName}</div>
                <div className="x">
                  {it.size} · {it.color} · ×{it.quantity}
                </div>
              </div>
              <div>{formatINR(it.unitPrice * it.quantity)}</div>
            </div>
          ))}
          <div className="oitem">
            <div className="x">
              Delivery ({order.deliveryMethod === 'priority' ? 'Priority' : 'Standard'})
            </div>
            <div>{order.deliveryFee === 0 ? 'Complimentary' : formatINR(order.deliveryFee)}</div>
          </div>
        </div>
        <div>
          <h4>Ship To</h4>
          <address>
            {order.firstName} {order.lastName}
            <br />
            {order.addressLine1}
            {order.addressLine2 ? (
              <>
                <br />
                {order.addressLine2}
              </>
            ) : null}
            <br />
            {order.city}, {order.state} {order.pincode}
            <br />
            {order.country}
            <br />
            {order.email} · {order.phone}
          </address>
        </div>
        <div>
          <h4>Move Status</h4>
          {nexts.length === 0 ? (
            <p className="final">
              This order is {ORDER_STATUS_LABELS[order.status].toLowerCase()} — no further
              transitions.
            </p>
          ) : (
            <div className="field">
              <label className="lab" htmlFor={`status-${order.id}`}>
                Status
              </label>
              <select
                id={`status-${order.id}`}
                className="inp"
                value={order.status}
                onChange={(e) => {
                  const next = e.target.value as OrderStatus;
                  if (next !== order.status) void moveOrder(order, next);
                }}
              >
                <option value={order.status} disabled>
                  {ORDER_STATUS_LABELS[order.status]} (current)
                </option>
                {nexts.map((s) => (
                  <option key={s} value={s}>
                    {ORDER_STATUS_LABELS[s]}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      </div>
    );
  };

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The Order Book</span>
        <h1>Orders</h1>
      </div>

      <div className="chips" role="group" aria-label="Filter by status">
        <button
          type="button"
          className={filter === 'all' ? 'chip on' : 'chip'}
          onClick={() => setFilter('all')}
        >
          All
        </button>
        {ORDER_STATUSES.map((s) => (
          <button
            key={s}
            type="button"
            className={filter === s ? 'chip on' : 'chip'}
            onClick={() => setFilter(s)}
          >
            {ORDER_STATUS_LABELS[s]}
          </button>
        ))}
      </div>

      <p className="section-label">
        {filter === 'all' ? 'All orders' : ORDER_STATUS_LABELS[filter]}
      </p>

      {error && <p className="state-note">{error}</p>}
      {!orders && !error && <p className="state-note">Loading orders…</p>}
      {orders && (
        <DataTable
          columns={columns}
          rows={orders}
          rowKey={(o) => o.id}
          empty="No orders in this state."
          renderExpanded={renderExpanded}
        />
      )}
    </>
  );
}
