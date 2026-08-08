import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Link, useLocation, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatINR } from '../lib/format';
import { usePageTitle } from '../lib/pageChrome';
import { useDeferredStatus } from '../lib/useDeferredStatus';
import type { DocumentSummary, Order, OrderStatus, ReceiptMode } from '../lib/types';
import {
  BILL_TYPE_LABELS,
  CHANNEL_LABELS,
  DOCUMENT_KIND_LABELS,
  ORDER_STATUS_LABELS,
  cancellableFrom,
  transitionsFor,
} from '../lib/types';
import type { ShippingReceiptDraft } from '../lib/uploads';
import { fetchDocumentImage, parseDocument, uploadDocument } from '../lib/uploads';
import { STATUS_MESSAGES, waLink } from '../lib/whatsapp';
import StatusBadge from '../components/StatusBadge';
import { useToast } from '../components/Toast';
import { Button, Field, Input, SegmentedControl, Sheet, Skeleton } from '../components/ui';

/** Local YYYY-MM-DD `days` from today — mirrors the OrderIntake quick-set chips. */
function plusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

const MODE_OPTIONS: { value: ReceiptMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'online', label: 'Online' },
];

export default function OrderDetail() {
  const { id = '' } = useParams();
  const location = useLocation();
  const toast = useToast();

  // The list hands the whole order across on navigation — there is no
  // GET /api/admin/orders/:id, so a cold deep link refetches the list instead.
  const seeded = (location.state as { order?: Order } | null)?.order;
  const [order, setOrder] = useState<Order | null>(seeded && seeded.id === id ? seeded : null);
  const [loading, setLoading] = useState(!(seeded && seeded.id === id));
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (seeded && seeded.id === id) return;
    let live = true;
    setLoading(true);
    api<Order[]>('/api/admin/orders')
      .then((rows) => {
        if (!live) return;
        setOrder(rows.find((o) => o.id === id) ?? null);
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!live) return;
        setError(err.message);
        setLoading(false);
      });
    return () => {
      live = false;
    };
  }, [id, seeded]);

  usePageTitle(order?.orderNumber ?? null);

  if (loading) return <Skeleton variant="rows" count={4} label="Loading order" />;
  if (error) return <p className="state-note">{error}</p>;
  if (!order) {
    return (
      <p className="state-note">
        That order is no longer in the book. <Link to="/orders">Back to orders</Link>
      </p>
    );
  }

  return <OrderDetailView order={order} onOrder={setOrder} onError={setError} toast={toast} />;
}

interface ViewProps {
  order: Order;
  onOrder: (order: Order) => void;
  onError: (message: string) => void;
  toast: ReturnType<typeof useToast>;
}

function OrderDetailView({ order, onOrder, onError, toast }: ViewProps) {
  const [amount, setAmount] = useState('');
  const [mode, setMode] = useState<ReceiptMode>('cash');
  const [payBusy, setPayBusy] = useState(false);
  const [due, setDue] = useState(order.deliveryDueDate ?? '');
  const [dueBusy, setDueBusy] = useState(false);
  const [docs, setDocs] = useState<DocumentSummary[]>([]);
  const [docImages, setDocImages] = useState<Record<string, string>>({});
  const [receipt, setReceipt] = useState<{ documentId: string; carrier: string; awb: string } | null>(null);
  const [receiptBusy, setReceiptBusy] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [cancelBusy, setCancelBusy] = useState(false);
  const receiptInput = useRef<HTMLInputElement>(null);

  const message = STATUS_MESSAGES[order.status]?.(order);
  const nexts = transitionsFor(order).filter((s) => s !== 'cancelled');
  const canCancel = cancellableFrom(order);

  const { advance } = useDeferredStatus({
    onApply: (_orderId, next) => onOrder({ ...order, status: next }),
    onRevert: (_orderId, prev) => onOrder({ ...order, status: prev }),
    onError,
  });

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
      .catch(() => {}); // documents are decorative here; never break the page
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
      onOrder(updated);
      toast('Shipping receipt attached');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to save the shipping receipt');
    } finally {
      setReceiptBusy(false);
    }
  };

  const recordPayment = async (e: FormEvent) => {
    e.preventDefault();
    const paise = Math.round(Number(amount) * 100);
    if (!Number.isFinite(paise) || paise <= 0) {
      onError('Enter the received amount in rupees');
      return;
    }
    setPayBusy(true);
    try {
      const updated = await api<Order>(`/api/admin/orders/${order.id}/receipts`, {
        method: 'POST',
        body: { amount: paise, mode },
      });
      setAmount('');
      onOrder(updated);
      toast(`Payment of ${formatINR(paise)} recorded`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to record the payment');
    } finally {
      setPayBusy(false);
    }
  };

  // Explicit save — a date input fires onChange on every keystroke, and each one
  // used to be a PATCH.
  const saveDueDate = async () => {
    setDueBusy(true);
    try {
      const updated = await api<Order>(`/api/admin/orders/${order.id}`, {
        method: 'PATCH',
        body: { deliveryDueDate: due || null },
      });
      onOrder(updated);
      toast('Delivery date saved');
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to save the delivery date');
    } finally {
      setDueBusy(false);
    }
  };

  const cancelOrder = async () => {
    setCancelBusy(true);
    try {
      const updated = await api<Order>(`/api/admin/orders/${order.id}`, {
        method: 'PATCH',
        body: { status: 'cancelled' as OrderStatus },
      });
      onOrder(updated);
      setCancelOpen(false);
      toast(`${order.orderNumber} cancelled`);
    } catch (err) {
      onError(err instanceof Error ? err.message : 'Unable to cancel the order');
    } finally {
      setCancelBusy(false);
    }
  };

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The Order Book</span>
        <h1>{order.orderNumber}</h1>
      </div>

      <div className="odetail">
        <section aria-label="Items">
          <h4>Items</h4>
          {order.items.map((it) => (
            <div className="oitem" key={it.id}>
              <div>
                <div className="nm">{it.productName}</div>
                <div className="x">
                  {[it.size, it.color].filter(Boolean).join(' · ') || 'Freeform'} · ×{it.quantity}
                  {(it.dupattaPrice != null || it.jacketPrice != null) &&
                    ` · with ${[it.dupattaPrice != null && 'dupatta', it.jacketPrice != null && 'jacket']
                      .filter(Boolean)
                      .join(' & ')}`}
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
          <div className="oitem ototal">
            <div>Total</div>
            <div>{formatINR(order.total)}</div>
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

          <h4 className="odetail-sub">Documents</h4>
          {docs.length === 0 ? (
            <p className="x">No photos attached yet.</p>
          ) : (
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
            accept="image/*,.heic,.heif"
            capture="environment"
            hidden
            aria-label={`Shipping receipt photo for ${order.orderNumber}`}
            onChange={(e) => void onReceiptFile(e)}
          />
          {receipt ? (
            <div className="receipt-edit">
              <Field id="oc-carrier" label="Carrier">
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={receipt.carrier}
                    onChange={(e) => setReceipt((r) => r && { ...r, carrier: e.target.value })}
                  />
                )}
              </Field>
              <Field id="oc-awb" label="AWB">
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={receipt.awb}
                    onChange={(e) => setReceipt((r) => r && { ...r, awb: e.target.value })}
                  />
                )}
              </Field>
              <Button fit busy={receiptBusy} onClick={() => void saveReceipt()}>
                {receiptBusy ? 'Saving…' : 'Save receipt'}
              </Button>
            </div>
          ) : (
            <Button fit busy={receiptBusy} onClick={() => receiptInput.current?.click()}>
              {receiptBusy ? 'Uploading…' : 'Attach shipping receipt'}
            </Button>
          )}
        </section>

        <section aria-label="Customer">
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
          <div className="odetail-acts">
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
              <Button fit disabled>
                Send WhatsApp update
              </Button>
            )}
          </div>
        </section>

        <section aria-label="Payments and status">
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
              <Field id="oc-amount" label="Amount (₹)">
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
              <Button type="submit" fit busy={payBusy}>
                Record payment
              </Button>
            </form>
          )}

          <h4 className="odetail-sub">Delivery</h4>
          <Field id="oc-due" label="Delivery due">
            {(a11y) => (
              <Input {...a11y} type="date" value={due} onChange={(e) => setDue(e.target.value)} />
            )}
          </Field>
          <div className="chips" role="group" aria-label="Quick due date">
            {[7, 14, 21].map((days) => (
              <button key={days} type="button" className="chip" onClick={() => setDue(plusDays(days))}>
                +{days} days
              </button>
            ))}
          </div>
          <div className="odetail-acts">
            <Button fit busy={dueBusy} onClick={() => void saveDueDate()}>
              {dueBusy ? 'Saving…' : 'Save date'}
            </Button>
          </div>

          <h4 className="odetail-sub">Status</h4>
          <p className="odetail-status">
            <StatusBadge status={order.status} />
            <span className="badge muted">{CHANNEL_LABELS[order.channel]}</span>
          </p>
          {nexts.length === 0 && !canCancel ? (
            <p className="final">
              This order is {ORDER_STATUS_LABELS[order.status].toLowerCase()} — no further transitions.
            </p>
          ) : (
            <div className="odetail-acts">
              {nexts.map((s) => (
                <Button
                  key={s}
                  variant="gold"
                  fit
                  aria-label={`Move to ${ORDER_STATUS_LABELS[s]}`}
                  onClick={() => advance(order, s)}
                >
                  → {ORDER_STATUS_LABELS[s]}
                </Button>
              ))}
              {canCancel && (
                <Button variant="ghost" onClick={() => setCancelOpen(true)}>
                  Cancel order
                </Button>
              )}
            </div>
          )}
        </section>
      </div>

      <Sheet
        open={cancelOpen}
        onClose={() => setCancelOpen(false)}
        title="Cancel this order?"
        footer={
          <div className="sheet-actions">
            <Button variant="gold" busy={cancelBusy} onClick={() => void cancelOrder()}>
              Yes, cancel it
            </Button>
            <Button onClick={() => setCancelOpen(false)}>Keep the order</Button>
          </div>
        }
      >
        <p className="x">
          {order.orderNumber} for {order.firstName} {order.lastName} will be marked cancelled. The
          order book only moves forward — this cannot be undone.
        </p>
      </Sheet>
    </>
  );
}
