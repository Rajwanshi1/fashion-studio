import { useCallback, useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { api } from '../lib/api';
import { bucketDeliveries, relativeDue, type DeliveryBuckets } from '../lib/deliveries';
import { formatDate, formatINR } from '../lib/format';
import { useDeferredStatus } from '../lib/useDeferredStatus';
import type { Order, OrderStatus, ReceiptMode } from '../lib/types';
import { BILL_TYPE_LABELS, CHANNEL_LABELS, ORDER_STATUS_LABELS, transitionsFor } from '../lib/types';
import { STATUS_MESSAGES, waLink } from '../lib/whatsapp';
import StatCard from '../components/StatCard';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { Button, Field, Input, SegmentedControl, Sheet } from '../components/ui';

interface DeliveriesResponse {
  orders: Order[];
  totals: { pendingToCollect: number; collectedCash: number; collectedOnline: number };
}

const BUCKET_META: { key: keyof DeliveryBuckets; title: string; open: boolean; overdue?: boolean }[] = [
  { key: 'overdue', title: 'Overdue', open: true, overdue: true },
  { key: 'next7', title: 'Next 7 days', open: true },
  { key: 'next14', title: '8–14 days', open: false },
  { key: 'next21', title: '15–21 days', open: false },
  { key: 'later', title: 'Later', open: false },
];

const MODE_OPTIONS: { value: ReceiptMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'online', label: 'Online' },
];

const customerName = (order: Order) => `${order.firstName} ${order.lastName}`.trim() || order.phone;

/** The next production step (never cancellation — that stays on the Orders page). */
function nextStatus(order: Order): OrderStatus | null {
  return transitionsFor(order).find((s) => s !== 'cancelled') ?? null;
}

function DeliveryCard({
  order,
  today,
  onAdvance,
  onPay,
}: {
  order: Order;
  today: string;
  onAdvance: (order: Order, next: OrderStatus) => void;
  onPay: (order: Order) => void;
}) {
  const name = customerName(order);
  const address = [order.addressLine1, order.city, order.pincode].filter(Boolean).join(', ');
  const message = STATUS_MESSAGES[order.status]?.(order);
  const next = nextStatus(order);

  return (
    <div className="dl-card">
      <div className="dl-top">
        <div>
          <div className="nm">{name}</div>
          <div className="dim">
            {order.orderNumber} · due {relativeDue(today, order.deliveryDueDate!)} ·{' '}
            {formatDate(order.deliveryDueDate!)}
          </div>
        </div>
        <div className="dl-balance">
          {order.balance > 0 ? (
            <>
              <span className="v">{formatINR(order.balance)}</span>
              <span className="dim">to collect</span>
            </>
          ) : (
            <span className="dl-paid">Paid in full</span>
          )}
        </div>
      </div>
      <div className="dl-badges">
        <StatusBadge status={order.status} />
        <span className="badge muted">{CHANNEL_LABELS[order.channel]}</span>
        {order.billType && <span className="badge muted">{BILL_TYPE_LABELS[order.billType]}</span>}
      </div>
      {address && (
        <a
          className="dl-addr"
          href={`https://maps.google.com/?q=${encodeURIComponent(address)}`}
          target="_blank"
          rel="noreferrer"
        >
          {address}
        </a>
      )}
      <div className="dl-actions">
        {order.phone && (
          <a className="dl-act" href={`tel:${order.phone}`}>
            Call
          </a>
        )}
        {order.phone && message && (
          <a className="dl-act" href={waLink(order.phone, message)} target="_blank" rel="noreferrer">
            WhatsApp
          </a>
        )}
        {order.balance > 0 && (
          <button
            type="button"
            className="dl-act"
            aria-label={`Record payment for ${order.orderNumber}`}
            onClick={() => onPay(order)}
          >
            ₹ Payment
          </button>
        )}
        {next && (
          <button type="button" className="dl-act" onClick={() => onAdvance(order, next)}>
            → {ORDER_STATUS_LABELS[next]}
          </button>
        )}
      </div>
    </div>
  );
}

export default function Deliveries() {
  const toast = useToast();
  const [data, setData] = useState<DeliveriesResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [payOrder, setPayOrder] = useState<Order | null>(null);
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<ReceiptMode>('cash');
  const [payBusy, setPayBusy] = useState(false);
  const today = new Date().toISOString().slice(0, 10);

  useEffect(() => {
    let live = true;
    api<DeliveriesResponse>('/api/admin/deliveries')
      .then((d) => live && setData(d))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  const setStatus = (orderId: string, status: OrderStatus) =>
    setData((cur) =>
      cur
        ? { ...cur, orders: cur.orders.map((o) => (o.id === orderId ? { ...o, status } : o)) }
        : cur,
    );

  // The card moves buckets (or leaves the board) the moment it is tapped; the
  // PATCH waits out the undo window, and Undo puts the card back.
  const { advance } = useDeferredStatus({ onApply: setStatus, onRevert: setStatus });

  const openPayment = (order: Order) => {
    setPayOrder(order);
    setAmount(String(order.balance / 100));
    setMode('cash');
  };

  // Stable identity: the sheet re-arms its focus trap whenever onClose changes,
  // which would pull focus out of the amount field on every keystroke.
  const closePayment = useCallback(() => setPayOrder(null), []);

  const recordPayment = async (e: FormEvent) => {
    e.preventDefault();
    if (!payOrder) return;
    const paise = Math.round(Number(amount) * 100);
    if (!Number.isFinite(paise) || paise <= 0) {
      toast('Enter the received amount in rupees', { tone: 'error' });
      return;
    }
    setPayBusy(true);
    try {
      const updated = await api<Order>(`/api/admin/orders/${payOrder.id}/receipts`, {
        method: 'POST',
        body: { amount: paise, mode },
      });
      setData((cur) => {
        if (!cur) return cur;
        const before = cur.orders.find((o) => o.id === updated.id);
        // Keep the money tiles honest without a refetch: what left the balance
        // was collected, in the mode just recorded.
        const collected = before ? Math.max(0, before.balance - updated.balance) : 0;
        return {
          orders: cur.orders.map((o) => (o.id === updated.id ? updated : o)),
          totals: {
            pendingToCollect: cur.totals.pendingToCollect - collected,
            collectedCash: cur.totals.collectedCash + (mode === 'cash' ? paise : 0),
            collectedOnline: cur.totals.collectedOnline + (mode === 'online' ? paise : 0),
          },
        };
      });
      setPayOrder(null);
      toast(`Payment of ${formatINR(paise)} recorded`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to record the payment', { tone: 'error' });
    } finally {
      setPayBusy(false);
    }
  };

  const buckets = data ? bucketDeliveries(data.orders, today) : null;

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The Atelier · Production</span>
        <h1>Deliveries</h1>
      </div>

      {error && <p className="state-note">{error}</p>}
      {!data && !error && <p className="state-note">Loading the delivery board…</p>}

      {data && buckets && (
        <>
          <div className="dl-totals">
            <StatCard label="To collect" value={formatINR(data.totals.pendingToCollect)} />
            <StatCard label="Cash received" value={formatINR(data.totals.collectedCash)} />
            <StatCard label="Online received" value={formatINR(data.totals.collectedOnline)} />
          </div>

          {data.orders.length === 0 && (
            <p className="state-note">
              No delivery dates set — add due dates from Orders or the Scan Bill flow.
            </p>
          )}

          {BUCKET_META.map(({ key, title, open, overdue }) => {
            const orders = buckets[key];
            if (orders.length === 0 && key !== 'overdue') return null;
            return (
              <details className={`dl-bucket${overdue ? ' overdue' : ''}`} open={open} key={key}>
                <summary>
                  <span>{title}</span>
                  <span className="dl-count">{orders.length}</span>
                </summary>
                {orders.length === 0 && <p className="dl-empty">Nothing here — lovely.</p>}
                {orders.map((o) => (
                  <DeliveryCard
                    key={o.id}
                    order={o}
                    today={today}
                    onAdvance={advance}
                    onPay={openPayment}
                  />
                ))}
              </details>
            );
          })}
        </>
      )}

      <Sheet
        open={payOrder !== null}
        onClose={closePayment}
        title={payOrder ? `Payment · ${customerName(payOrder)}` : 'Payment'}
      >
        {payOrder && (
          <form onSubmit={(e) => void recordPayment(e)}>
            <p className="x">
              {payOrder.orderNumber} · {formatINR(payOrder.balance)} to collect
            </p>
            <Field id="dl-amount" label="Amount (₹)">
              {(a11y) => (
                <Input
                  {...a11y}
                  type="number"
                  min="0"
                  step="0.01"
                  inputMode="decimal"
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                />
              )}
            </Field>
            <div className="field">
              <span className="lab">Mode</span>
              <SegmentedControl
                label="Payment mode"
                options={MODE_OPTIONS}
                value={mode}
                onChange={setMode}
              />
            </div>
            <Button type="submit" variant="gold" fit busy={payBusy}>
              Record payment
            </Button>
          </form>
        )}
      </Sheet>
    </>
  );
}
