import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { api } from '../lib/api';
import { formatDate, formatINR } from '../lib/format';
import type { BillType, DocumentSummary, Order, OrderChannel, OrderStatus, ReceiptMode } from '../lib/types';
import {
  BILL_TYPE_LABELS,
  CHANNELS,
  CHANNEL_LABELS,
  DOCUMENT_KIND_LABELS,
  ORDER_STATUSES,
  ORDER_STATUS_LABELS,
  transitionsFor,
} from '../lib/types';
import type { ShippingReceiptDraft } from '../lib/uploads';
import { fetchDocumentImage, parseDocument, uploadDocument } from '../lib/uploads';
import { STATUS_MESSAGES, waLink } from '../lib/whatsapp';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';

type StatusFilter = 'all' | OrderStatus;
type ChannelFilter = 'all' | OrderChannel;
type BillFilter = 'all' | BillType;

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

interface ExpandedProps {
  order: Order;
  onUpdated: (order: Order, message?: string) => void;
  onError: (message: string) => void;
}

function ExpandedOrder({ order, onUpdated, onError }: ExpandedProps) {
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<ReceiptMode>('cash');
  const [busy, setBusy] = useState(false);
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [docImages, setDocImages] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<{ documentId: string; carrier: string; awb: string } | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const receiptInput = useRef<HTMLInputElement>(null);
  const nexts = transitionsFor(order);
  const message = STATUS_MESSAGES[order.status]?.(order);

  useEffect(() => {
    let live = true;
    api<DocumentSummary[]>(`/api/admin/orders/${order.id}/documents`)
      .then((rows) => {
        if (!live) return;
        setDocs(rows);
        for (const doc of rows) {
          fetchDocumentImage(doc.id)
            .then((url) => live && setDocImages((m) => ({ ...m, [doc.id]: url })))
            .catch(() => {}); // thumbnail is a nicety — the row stays a labeled link
        }
      })
      .catch(() => {}); // documents are decorative here; never break the row
    return () => {
      live = false;
    };
  }, [order.id]);

  const onReceiptFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setReceiptBusy(true);
    try {
      const shot = await uploadDocument('shipping_receipt', file);
      let carrier = order.carrier ?? '';
      let awb = order.awb ?? '';
      try {
        const draft = await parseDocument<ShippingReceiptDraft>(shot.documentId);
        carrier = draft.carrier ?? carrier;
        awb = draft.awb_number ?? awb;
      } catch {
        // parsing masked (503) or failed — the admin types carrier/AWB by hand
      }
      setReceipt({ documentId: shot.documentId, carrier, awb });
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Photo upload failed');
    } finally {
      setReceiptBusy(false);
    }
  };

  const saveReceipt = async () => {
    if (!receipt) return;
    setReceiptBusy(true);
    try {
      const updated = await api<Order>(`/api/admin/orders/${order.id}`, {
        method: 'PATCH',
        body: { carrier: receipt.carrier.trim() || null, awb: receipt.awb.trim() || null },
      });
      const attached = await api<DocumentSummary>(`/api/admin/orders/${order.id}/documents`, {
        method: 'POST',
        body: { documentId: receipt.documentId },
      });
      setDocs((all) => [...all, attached]);
      setReceipt(null);
      onUpdated(updated, 'Shipping receipt attached');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to save the shipping receipt');
    } finally {
      setReceiptBusy(false);
    }
  };

  const moveOrder = async (status: OrderStatus) => {
    try {
      const updated = await api<Order>(`/api/admin/orders/${order.id}`, {
        method: 'PATCH',
        body: { status },
      });
      onUpdated(updated, `Order ${order.orderNumber} → ${ORDER_STATUS_LABELS[status]}`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to update order');
    }
  };

  const saveDueDate = async (value: string) => {
    try {
      const updated = await api<Order>(`/api/admin/orders/${order.id}`, {
        method: 'PATCH',
        body: { deliveryDueDate: value || null },
      });
      onUpdated(updated, 'Delivery date saved');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to save the delivery date');
    }
  };

  const recordPayment = async (e: FormEvent) => {
    e.preventDefault();
    const paise = Math.round(Number(amount) * 100);
    if (!Number.isFinite(paise) || paise <= 0) {
      onError('Enter the received amount in rupees');
      return;
    }
    setBusy(true);
    try {
      const updated = await api<Order>(`/api/admin/orders/${order.id}/receipts`, {
        method: 'POST',
        body: { amount: paise, mode },
      });
      setAmount('');
      onUpdated(updated, `Payment of ${formatINR(paise)} recorded`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to record the payment');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="odetail">
      <div>
        <h4>Items</h4>
        {order.items.map((it) => (
          <div className="oitem" key={it.id}>
            <div>
              <div className="nm">{it.productName}</div>
              <div className="x">
                {[it.size, it.color].filter(Boolean).join(' · ') || 'Freeform'} · ×{it.quantity}
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
        {order.billNumber && (
          <p className="x">
            Bill {order.billNumber}
            {order.billType ? ` · ${BILL_TYPE_LABELS[order.billType]}` : ''}
            {order.gstAmount != null ? ` · GST ${formatINR(order.gstAmount)}` : ''}
          </p>
        )}
        {order.notes && <p className="x">Notes: {order.notes}</p>}
        {(order.carrier || order.awb) && (
          <p className="x">
            Ships via {order.carrier || '—'} · AWB {order.awb || '—'}
          </p>
        )}
        {docs.length > 0 && (
          <div className="doc-thumbs">
            {docs.map((doc) => (
              <a
                key={doc.id}
                className="doc-thumb"
                href={docImages[doc.id]}
                target="_blank"
                rel="noreferrer"
              >
                {docImages[doc.id] && <img src={docImages[doc.id]} alt={DOCUMENT_KIND_LABELS[doc.kind]} />}
                <span>{DOCUMENT_KIND_LABELS[doc.kind]}</span>
              </a>
            ))}
          </div>
        )}
        <input
          ref={receiptInput}
          type="file"
          accept="image/*"
          capture="environment"
          hidden
          aria-label={`Shipping receipt photo for ${order.orderNumber}`}
          onChange={(e) => void onReceiptFile(e)}
        />
        {receipt ? (
          <div className="receipt-edit">
            <div className="field">
              <label className="lab" htmlFor={`carrier-${order.id}`}>
                Carrier
              </label>
              <input
                id={`carrier-${order.id}`}
                className="inp"
                value={receipt.carrier}
                onChange={(e) => setReceipt((r) => r && { ...r, carrier: e.target.value })}
              />
            </div>
            <div className="field">
              <label className="lab" htmlFor={`awb-${order.id}`}>
                AWB
              </label>
              <input
                id={`awb-${order.id}`}
                className="inp"
                value={receipt.awb}
                onChange={(e) => setReceipt((r) => r && { ...r, awb: e.target.value })}
              />
            </div>
            <button
              type="button"
              className="btn-outline fit"
              disabled={receiptBusy}
              onClick={() => void saveReceipt()}
            >
              {receiptBusy ? 'Saving…' : 'Save receipt'}
            </button>
          </div>
        ) : (
          <button
            type="button"
            className="btn-outline fit"
            disabled={receiptBusy}
            onClick={() => receiptInput.current?.click()}
          >
            {receiptBusy ? 'Uploading…' : 'Attach shipping receipt'}
          </button>
        )}
      </div>
      <div>
        <h4>Customer</h4>
        <address>
          {order.firstName} {order.lastName}
          {order.addressLine1 ? (
            <>
              <br />
              {order.addressLine1}
            </>
          ) : null}
          {order.addressLine2 ? (
            <>
              <br />
              {order.addressLine2}
            </>
          ) : null}
          {order.city || order.state || order.pincode ? (
            <>
              <br />
              {order.city}
              {order.city && order.state ? ', ' : ''}
              {order.state} {order.pincode}
            </>
          ) : null}
          <br />
          {order.email || 'no email'} ·{' '}
          {order.phone ? <a href={`tel:${order.phone}`}>{order.phone}</a> : 'no phone'}
        </address>
        {order.phone && message ? (
          <a
            className="btn-outline fit"
            href={waLink(order.phone, message)}
            target="_blank"
            rel="noreferrer"
          >
            Send WhatsApp update
          </a>
        ) : (
          <button type="button" className="btn-outline fit" disabled>
            Send WhatsApp update
          </button>
        )}
      </div>
      <div>
        {(order.channel !== 'online' || order.receipts.length > 0) && (
          <>
            <h4>Payments</h4>
            {order.receipts.length === 0 ? (
              <p className="x">No payments recorded.</p>
            ) : (
              order.receipts.map((r) => (
                <div className="oitem" key={r.id}>
                  <div className="x">
                    {r.receivedAt} · {r.mode === 'cash' ? 'Cash' : 'Online'}
                    {r.note ? ` · ${r.note}` : ''}
                  </div>
                  <div>{formatINR(r.amount)}</div>
                </div>
              ))
            )}
            <div className="oitem">
              <div className="x">Balance</div>
              <div>{formatINR(order.balance)}</div>
            </div>
          </>
        )}
        {order.channel !== 'online' && order.balance > 0 && (
          <form className="pay-form" onSubmit={recordPayment}>
            <div className="field">
              <label className="lab" htmlFor={`pay-${order.id}`}>
                Amount (₹)
              </label>
              <input
                id={`pay-${order.id}`}
                className="inp"
                type="number"
                min="0"
                inputMode="numeric"
                value={amount}
                onChange={(e) => setAmount(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="lab" htmlFor={`pay-mode-${order.id}`}>
                Mode
              </label>
              <select
                id={`pay-mode-${order.id}`}
                className="inp"
                value={mode}
                onChange={(e) => setMode(e.target.value as ReceiptMode)}
              >
                <option value="cash">Cash</option>
                <option value="online">Online</option>
              </select>
            </div>
            <button className="btn-outline fit" type="submit" disabled={busy}>
              Record payment
            </button>
          </form>
        )}
        <div className="field">
          <label className="lab" htmlFor={`due-${order.id}`}>
            Delivery due
          </label>
          <input
            id={`due-${order.id}`}
            className="inp"
            type="date"
            value={order.deliveryDueDate ?? ''}
            onChange={(e) => void saveDueDate(e.target.value)}
          />
        </div>
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
                if (next !== order.status) void moveOrder(next);
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
}

export default function Orders() {
  const [filter, setFilter] = useState<StatusFilter>('all');
  const [channel, setChannel] = useState<ChannelFilter>('all');
  const [billType, setBillType] = useState<BillFilter>('all');
  const [orders, setOrders] = useState<Order[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    let live = true;
    setOrders(null);
    setError(null);
    const params = new URLSearchParams();
    if (filter !== 'all') params.set('status', filter);
    if (channel !== 'all') params.set('channel', channel);
    if (billType !== 'all') params.set('billType', billType);
    const query = params.toString();
    api<Order[]>(`/api/admin/orders${query ? `?${query}` : ''}`)
      .then((data) => live && setOrders(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [filter, channel, billType]);

  const replaceOrder = (order: Order, message?: string) => {
    setOrders((cur) => (cur ? cur.map((o) => (o.id === order.id ? order : o)) : cur));
    if (message) toast(message);
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

      <div className="chips" role="group" aria-label="Filter by channel">
        <button
          type="button"
          className={channel === 'all' ? 'chip on' : 'chip'}
          onClick={() => setChannel('all')}
        >
          All channels
        </button>
        {CHANNELS.map((ch) => (
          <button
            key={ch}
            type="button"
            className={channel === ch ? 'chip on' : 'chip'}
            onClick={() => setChannel(ch)}
          >
            {CHANNEL_LABELS[ch]}
          </button>
        ))}
      </div>

      <div className="chips" role="group" aria-label="Filter by bill type">
        <button
          type="button"
          className={billType === 'all' ? 'chip on' : 'chip'}
          onClick={() => setBillType('all')}
        >
          All bills
        </button>
        {(['gst_invoice', 'cash_memo'] as const).map((bt) => (
          <button
            key={bt}
            type="button"
            className={billType === bt ? 'chip on' : 'chip'}
            onClick={() => setBillType(bt)}
          >
            {BILL_TYPE_LABELS[bt]}
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
          renderExpanded={(order) => (
            <ExpandedOrder order={order} onUpdated={replaceOrder} onError={setError} />
          )}
        />
      )}
    </>
  );
}
