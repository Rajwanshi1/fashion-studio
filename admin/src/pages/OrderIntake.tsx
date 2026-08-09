import { useEffect, useRef, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { formatINR } from '../lib/format';
import { normalizePhone } from '../lib/phone';
import type { AdminUser, BillType, Order, OrderChannel, ReceiptMode } from '../lib/types';
import { BILL_TYPE_LABELS, CHANNEL_LABELS, OFFLINE_CHANNELS } from '../lib/types';
import KeyValueEditor, { EMPTY_SET } from '../components/KeyValueEditor';
import type { MeasurementSetState } from '../components/KeyValueEditor';
import { useToast } from '../components/Toast';

export interface ItemRow {
  description: string;
  qty: string;
  unitRupees: string;
}

const EMPTY_ITEM: ItemRow = { description: '', qty: '1', unitRupees: '' };

export interface FormState {
  phone: string;
  firstName: string;
  lastName: string;
  email: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  stateName: string;
  pincode: string;
  channel: Exclude<OrderChannel, 'online'>;
  billType: BillType;
  billNumber: string;
  gstRupees: string;
  totalRupees: string;
  advanceRupees: string;
  advanceMode: ReceiptMode;
  dueDate: string;
  notes: string;
  initialStatus: 'in_atelier' | 'delivered';
}

const EMPTY_FORM: FormState = {
  phone: '',
  firstName: '',
  lastName: '',
  email: '',
  addressLine1: '',
  addressLine2: '',
  city: '',
  stateName: '',
  pincode: '',
  channel: 'in_store',
  billType: 'gst_invoice',
  billNumber: '',
  gstRupees: '',
  totalRupees: '',
  advanceRupees: '',
  advanceMode: 'cash',
  dueDate: '',
  notes: '',
  initialStatus: 'in_atelier',
};

const toPaise = (rupees: string) => Math.round(Number(rupees) * 100);

function plusDays(days: number): string {
  const d = new Date();
  d.setDate(d.getDate() + days);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

export interface OrderIntakeFormProps {
  /** Prefill from a parsed bill draft — absent fields keep the blank defaults. */
  initial?: { form?: Partial<FormState>; items?: ItemRow[] };
  /** Uploaded photo document ids — confirmed + attached when the order records. */
  documentIds?: string[];
  /** Prefilled measurement sets (from parsed measurement pages). */
  measurementSets?: MeasurementSetState[];
  /** Called with the created order instead of the default toast + /orders redirect. */
  onDone?: (order: Order) => void;
}

/** The shared bill-entry form — used directly at /orders/new and as the review step of /intake. */
export function OrderIntakeForm({ initial, documentIds, measurementSets, onDone }: OrderIntakeFormProps) {
  const navigate = useNavigate();
  const toast = useToast();

  const [form, setForm] = useState<FormState>({ ...EMPTY_FORM, ...initial?.form });
  const [items, setItems] = useState<ItemRow[]>(
    initial?.items?.length ? initial.items.map((r) => ({ ...r })) : [{ ...EMPTY_ITEM }],
  );
  const [msets, setMsets] = useState<MeasurementSetState[]>(
    (measurementSets ?? []).map((s) => ({ ...s, rows: s.rows.map((r) => ({ ...r })) })),
  );
  const [candidates, setCandidates] = useState<AdminUser[]>([]);
  const [linked, setLinked] = useState<AdminUser | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errRef = useRef<HTMLDivElement>(null);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  // Bring the submit error into view and announce it — it renders next to the actions.
  useEffect(() => {
    if (!error) return;
    errRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    errRef.current?.focus();
  }, [error]);

  // Debounced customer match on the phone the admin is typing.
  useEffect(() => {
    if (linked || form.phone.trim().length < 4) {
      setCandidates([]);
      return;
    }
    let live = true;
    const timer = setTimeout(() => {
      api<{ candidates: AdminUser[] }>(
        `/api/admin/customers/match?phone=${encodeURIComponent(form.phone)}`,
      )
        .then((data) => live && setCandidates(data.candidates))
        .catch(() => live && setCandidates([]));
    }, 300);
    return () => {
      live = false;
      clearTimeout(timer);
    };
  }, [form.phone, linked]);

  const setItem = (index: number, key: keyof ItemRow, value: string) =>
    setItems((rows) => rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));

  const subtotalPaise = items.reduce((sum, r) => {
    const qty = Math.round(Number(r.qty) || 0);
    const unit = toPaise(r.unitRupees || '0');
    return sum + (Number.isFinite(unit) ? unit * qty : 0);
  }, 0);
  const totalPaise = form.totalRupees.trim() === '' ? subtotalPaise : toPaise(form.totalRupees);
  const advancePaise = form.advanceRupees.trim() === '' ? 0 : toPaise(form.advanceRupees);
  const balancePaise = totalPaise - advancePaise;

  // Cross-check the entered total against what the items (and GST) add up to.
  const enteredTotalPaise = form.totalRupees.trim() === '' ? null : toPaise(form.totalRupees);
  const gstPaise =
    form.billType === 'gst_invoice' && form.gstRupees.trim() !== '' ? toPaise(form.gstRupees) : 0;
  const totalsMismatch =
    enteredTotalPaise != null &&
    Number.isFinite(enteredTotalPaise) &&
    subtotalPaise > 0 &&
    enteredTotalPaise !== subtotalPaise &&
    enteredTotalPaise !== subtotalPaise + gstPaise;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const rows = items.filter((r) => r.description.trim() !== '');
    if (rows.length === 0) {
      setError('Add at least one item from the bill');
      return;
    }
    if (rows.some((r) => !Number.isFinite(toPaise(r.unitRupees)) || Math.round(Number(r.qty) || 0) < 1)) {
      setError('Each item needs a quantity and a price in rupees');
      return;
    }
    if (!Number.isFinite(totalPaise) || totalPaise < 0 || (form.totalRupees.trim() === '' && subtotalPaise === 0)) {
      setError('Please enter the bill total in rupees');
      return;
    }
    if (advancePaise > totalPaise) {
      setError('Advance cannot exceed the total');
      return;
    }

    let customer;
    if (linked) {
      customer = { action: 'link' as const, userId: linked.id };
    } else {
      if (!form.firstName.trim()) {
        setError('Customer first name is required');
        return;
      }
      if (!normalizePhone(form.phone)) {
        setError('Enter a valid mobile number');
        return;
      }
      customer = {
        action: 'create' as const,
        firstName: form.firstName.trim(),
        lastName: form.lastName.trim() || undefined,
        phone: form.phone.trim(),
        email: form.email.trim() || undefined,
        addressLine1: form.addressLine1.trim() || undefined,
        addressLine2: form.addressLine2.trim() || undefined,
        city: form.city.trim() || undefined,
        state: form.stateName.trim() || undefined,
        pincode: form.pincode.trim() || undefined,
      };
    }

    // Sets keep only their named rows; a set with no named rows is dropped.
    const sets = msets
      .map((s) => ({
        label: s.label.trim() || undefined,
        data: Object.fromEntries(
          s.rows.filter((r) => r.name.trim() !== '').map((r) => [r.name.trim(), r.value]),
        ),
        notes: s.notes.trim() || undefined,
        documentId: s.documentId ?? undefined,
      }))
      .filter((s) => Object.keys(s.data).length > 0);

    const body = {
      channel: form.channel,
      billType: form.billType,
      billNumber: form.billNumber.trim() || undefined,
      customer,
      items: rows.map((r) => ({
        description: r.description.trim(),
        quantity: Math.round(Number(r.qty)),
        unitPrice: toPaise(r.unitRupees),
      })),
      gstAmount:
        form.billType === 'gst_invoice' && form.gstRupees.trim() !== ''
          ? toPaise(form.gstRupees)
          : undefined,
      total: totalPaise,
      advance: advancePaise > 0 ? { amount: advancePaise, mode: form.advanceMode } : undefined,
      deliveryDueDate: form.dueDate || undefined,
      notes: form.notes.trim() || undefined,
      initialStatus: form.initialStatus,
      documentIds: documentIds?.length ? documentIds : undefined,
      measurementSets: sets.length ? sets : undefined,
    };

    setBusy(true);
    try {
      const order = await api<Order>('/api/admin/orders', { method: 'POST', body });
      if (onDone) {
        onDone(order);
        return;
      }
      toast(`Order ${order.orderNumber} recorded`);
      // Land on the focused row — its expanded panel carries the invoice actions.
      navigate(`/orders?focus=${order.id}`);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record the order');
      setBusy(false);
    }
  };

  return (
    <form className="form-card" onSubmit={onSubmit} noValidate>
      <fieldset className="fset">
        <legend>Customer</legend>
        <div className="field">
          <label className="lab" htmlFor="oi-phone">
            Phone
          </label>
          <input
            id="oi-phone"
            className="inp"
            type="tel"
            inputMode="tel"
            placeholder="98200 12345"
            value={linked ? (linked.phone ?? '') : form.phone}
            disabled={!!linked}
            onChange={(e) => set('phone', e.target.value)}
          />
        </div>

        {linked ? (
          <div className="candidate linked">
            <div>
              <div className="nm">
                {linked.firstName} {linked.lastName}
              </div>
              <div className="x">
                {linked.phone ?? '—'} · {linked.email ?? 'no email'} · {linked.ordersCount}{' '}
                {linked.ordersCount === 1 ? 'order' : 'orders'}
              </div>
            </div>
            <button type="button" className="btn-outline fit" onClick={() => setLinked(null)}>
              Unlink
            </button>
          </div>
        ) : (
          <>
            {candidates.map((u) => (
              <div className="candidate" key={u.id}>
                <div>
                  <div className="nm">
                    {u.firstName} {u.lastName}
                  </div>
                  <div className="x">
                    {u.phone ?? '—'} · {u.email ?? 'no email'} · {u.ordersCount}{' '}
                    {u.ordersCount === 1 ? 'order' : 'orders'}
                  </div>
                </div>
                <button type="button" className="btn-outline fit" onClick={() => setLinked(u)}>
                  Link
                </button>
              </div>
            ))}
            <div className="grid2">
              <div className="field">
                <label className="lab" htmlFor="oi-first">
                  First Name
                </label>
                <input
                  id="oi-first"
                  className="inp"
                  value={form.firstName}
                  onChange={(e) => set('firstName', e.target.value)}
                />
              </div>
              <div className="field">
                <label className="lab" htmlFor="oi-last">
                  Last Name
                </label>
                <input
                  id="oi-last"
                  className="inp"
                  value={form.lastName}
                  onChange={(e) => set('lastName', e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label className="lab" htmlFor="oi-email">
                Email (optional)
              </label>
              <input
                id="oi-email"
                className="inp"
                type="email"
                value={form.email}
                onChange={(e) => set('email', e.target.value)}
              />
            </div>
            <div className="field">
              <label className="lab" htmlFor="oi-addr1">
                Address (optional)
              </label>
              <input
                id="oi-addr1"
                className="inp"
                value={form.addressLine1}
                onChange={(e) => set('addressLine1', e.target.value)}
              />
            </div>
            <div className="grid2">
              <div className="field">
                <label className="lab" htmlFor="oi-addr2">
                  Address Line 2 (optional)
                </label>
                <input
                  id="oi-addr2"
                  className="inp"
                  value={form.addressLine2}
                  onChange={(e) => set('addressLine2', e.target.value)}
                />
              </div>
              <div className="field">
                <label className="lab" htmlFor="oi-city">
                  City (optional)
                </label>
                <input
                  id="oi-city"
                  className="inp"
                  value={form.city}
                  onChange={(e) => set('city', e.target.value)}
                />
              </div>
            </div>
            <div className="grid2">
              <div className="field">
                <label className="lab" htmlFor="oi-state">
                  State (optional)
                </label>
                <input
                  id="oi-state"
                  className="inp"
                  value={form.stateName}
                  onChange={(e) => set('stateName', e.target.value)}
                />
              </div>
              <div className="field">
                <label className="lab" htmlFor="oi-pincode">
                  PIN Code (optional)
                </label>
                <input
                  id="oi-pincode"
                  className="inp"
                  value={form.pincode}
                  onChange={(e) => set('pincode', e.target.value)}
                />
              </div>
            </div>
          </>
        )}
      </fieldset>

      <fieldset className="fset">
        <legend>Channel</legend>
        <div className="chips" role="group" aria-label="Order channel">
          {OFFLINE_CHANNELS.map((ch) => (
            <button
              key={ch}
              type="button"
              className={form.channel === ch ? 'chip on' : 'chip'}
              aria-pressed={form.channel === ch}
              onClick={() => set('channel', ch)}
            >
              {CHANNEL_LABELS[ch]}
            </button>
          ))}
        </div>
      </fieldset>

      <fieldset className="fset">
        <legend>Bill</legend>
        <div className="chips" role="group" aria-label="Bill type">
          {(['gst_invoice', 'cash_memo'] as const).map((bt) => (
            <button
              key={bt}
              type="button"
              className={form.billType === bt ? 'chip on' : 'chip'}
              aria-pressed={form.billType === bt}
              onClick={() => set('billType', bt)}
            >
              {BILL_TYPE_LABELS[bt]}
            </button>
          ))}
        </div>
        <div className="grid2">
          <div className="field">
            <label className="lab" htmlFor="oi-billno">
              Bill Number
            </label>
            <input
              id="oi-billno"
              className="inp"
              value={form.billNumber}
              onChange={(e) => set('billNumber', e.target.value)}
            />
          </div>
          {form.billType === 'gst_invoice' && (
            <div className="field">
              <label className="lab" htmlFor="oi-gst">
                GST (₹ rupees)
              </label>
              <input
                id="oi-gst"
                className="inp"
                type="number"
                min="0"
                inputMode="numeric"
                value={form.gstRupees}
                onChange={(e) => set('gstRupees', e.target.value)}
              />
            </div>
          )}
        </div>
      </fieldset>

      <fieldset className="fset">
        <legend>Items</legend>
        {items.map((row, i) => (
          <div className="item-row" key={i}>
            <div className="field f-desc">
              <label className="lab" htmlFor={`oi-desc-${i}`}>
                Description
              </label>
              <input
                id={`oi-desc-${i}`}
                className="inp"
                value={row.description}
                onChange={(e) => setItem(i, 'description', e.target.value)}
              />
            </div>
            <div className="field">
              <label className="lab" htmlFor={`oi-qty-${i}`}>
                Qty
              </label>
              <input
                id={`oi-qty-${i}`}
                className="inp"
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={row.qty}
                onChange={(e) => setItem(i, 'qty', e.target.value)}
              />
            </div>
            <div className="field">
              <label className="lab" htmlFor={`oi-unit-${i}`}>
                Unit ₹
              </label>
              <input
                id={`oi-unit-${i}`}
                className="inp"
                type="number"
                min="0"
                inputMode="numeric"
                value={row.unitRupees}
                onChange={(e) => setItem(i, 'unitRupees', e.target.value)}
              />
            </div>
            {items.length > 1 && (
              <button
                type="button"
                className="icon-btn"
                aria-label={`Remove item ${i + 1}`}
                onClick={() => setItems((rows) => rows.filter((_, x) => x !== i))}
              >
                ✕
              </button>
            )}
          </div>
        ))}
        <button
          type="button"
          className="btn-outline fit"
          onClick={() => setItems((rows) => [...rows, { ...EMPTY_ITEM }])}
        >
          + Add Item
        </button>
      </fieldset>

      <fieldset className="fset">
        <legend>Measurements</legend>
        {msets.map((set, i) => (
          <KeyValueEditor
            key={i}
            idPrefix={`ms-${i}`}
            set={set}
            onChange={(next) => setMsets((all) => all.map((s, j) => (j === i ? next : s)))}
            onRemove={() => setMsets((all) => all.filter((_, j) => j !== i))}
          />
        ))}
        <button
          type="button"
          className="btn-outline fit"
          onClick={() => setMsets((all) => [...all, structuredClone(EMPTY_SET)])}
        >
          + Add Measurement Set
        </button>
      </fieldset>

      <fieldset className="fset">
        <legend>Totals</legend>
        <p className="x">Items sum to {formatINR(subtotalPaise)}</p>
        <div className="grid2">
          <div className="field">
            <label className="lab" htmlFor="oi-total">
              Bill Total (₹ rupees)
            </label>
            <input
              id="oi-total"
              className="inp"
              type="number"
              min="0"
              inputMode="numeric"
              placeholder={String(subtotalPaise / 100)}
              value={form.totalRupees}
              onChange={(e) => set('totalRupees', e.target.value)}
            />
          </div>
          <div className="field">
            <label className="lab" htmlFor="oi-advance">
              Advance (₹ rupees)
            </label>
            <input
              id="oi-advance"
              className="inp"
              type="number"
              min="0"
              inputMode="numeric"
              value={form.advanceRupees}
              onChange={(e) => set('advanceRupees', e.target.value)}
            />
          </div>
        </div>
        {totalsMismatch && (
          <p className="parse-note" role="note">
            Bill total is {formatINR(enteredTotalPaise)} but items{gstPaise > 0 ? ' + GST' : ''} sum
            to {formatINR(subtotalPaise + gstPaise)} — check item prices or GST.
          </p>
        )}
        <div className="chips" role="group" aria-label="Advance mode">
          {(['cash', 'online'] as const).map((mode) => (
            <button
              key={mode}
              type="button"
              className={form.advanceMode === mode ? 'chip on' : 'chip'}
              aria-pressed={form.advanceMode === mode}
              onClick={() => set('advanceMode', mode)}
            >
              {mode === 'cash' ? 'Cash' : 'Online'}
            </button>
          ))}
        </div>
        <p className="x">
          Balance: <strong>{formatINR(Number.isFinite(balancePaise) ? balancePaise : 0)}</strong>
        </p>
      </fieldset>

      <fieldset className="fset">
        <legend>Delivery</legend>
        <div className="field">
          <label className="lab" htmlFor="oi-due">
            Delivery Due Date
          </label>
          <input
            id="oi-due"
            className="inp"
            type="date"
            value={form.dueDate}
            onChange={(e) => set('dueDate', e.target.value)}
          />
        </div>
        <div className="chips" role="group" aria-label="Quick due date">
          {[7, 14, 21].map((days) => (
            <button
              key={days}
              type="button"
              className="chip"
              onClick={() => set('dueDate', plusDays(days))}
            >
              +{days} days
            </button>
          ))}
        </div>
        <div className="field">
          <label className="lab" htmlFor="oi-notes">
            Notes
          </label>
          <textarea
            id="oi-notes"
            className="inp"
            value={form.notes}
            onChange={(e) => set('notes', e.target.value)}
          />
        </div>
      </fieldset>

      <fieldset className="fset">
        <legend>Order status</legend>
        <div className="chips" role="group" aria-label="Initial status">
          <button
            type="button"
            className={form.initialStatus === 'in_atelier' ? 'chip on' : 'chip'}
            aria-pressed={form.initialStatus === 'in_atelier'}
            onClick={() => set('initialStatus', 'in_atelier')}
          >
            In production
          </button>
          <button
            type="button"
            className={form.initialStatus === 'delivered' ? 'chip on' : 'chip'}
            aria-pressed={form.initialStatus === 'delivered'}
            onClick={() => set('initialStatus', 'delivered')}
          >
            Delivered
          </button>
        </div>
      </fieldset>

      {error && (
        <div className="form-err" role="alert" tabIndex={-1} ref={errRef}>
          {error}
        </div>
      )}

      <div className="form-actions">
        <button className="btn-buy gold fit" type="submit" disabled={busy}>
          {busy ? 'Recording…' : 'Record Order'}
        </button>
        <button className="btn-outline fit" type="button" onClick={() => navigate('/orders')}>
          Cancel
        </button>
      </div>
    </form>
  );
}

/** Manual entry page — the wizard-free path at /orders/new. */
export default function OrderIntake() {
  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The Order Book</span>
        <h1>New Order</h1>
      </div>
      <OrderIntakeForm />
    </>
  );
}
