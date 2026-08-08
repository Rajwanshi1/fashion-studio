import { useEffect, useRef, useState } from 'react';
import type { FormEvent, ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { errorSummary, scrollToFirstError } from '../lib/formErrors';
import type { FieldErrors } from '../lib/formErrors';
import { formatINR } from '../lib/format';
import { normalizePhone } from '../lib/phone';
import type { AdminUser, BillType, Order, OrderChannel, ReceiptMode } from '../lib/types';
import { BILL_TYPE_LABELS, CHANNEL_LABELS, OFFLINE_CHANNELS } from '../lib/types';
import KeyValueEditor, { EMPTY_SET } from '../components/KeyValueEditor';
import type { MeasurementSetState } from '../components/KeyValueEditor';
import { useToast } from '../components/Toast';
import {
  Button,
  Field,
  Input,
  SegmentedControl,
  Stepper,
  StickyBar,
  Textarea,
} from '../components/ui';

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

/** Form keys whose validation error is pinned to a single input — changing one clears it. */
const FIELD_ERROR_IDS: Partial<Record<keyof FormState, string>> = {
  phone: 'oi-phone',
  firstName: 'oi-first',
  totalRupees: 'oi-total',
  advanceRupees: 'oi-advance',
};

const ITEM_ERROR_KEYS: Record<keyof ItemRow, string> = {
  description: 'desc',
  qty: 'qty',
  unitRupees: 'unit',
};

const CHANNEL_OPTIONS = OFFLINE_CHANNELS.map((ch) => ({ value: ch, label: CHANNEL_LABELS[ch] }));
const BILL_TYPE_OPTIONS = (['gst_invoice', 'cash_memo'] as const).map((bt) => ({
  value: bt,
  label: BILL_TYPE_LABELS[bt],
}));
const ADVANCE_MODE_OPTIONS: { value: ReceiptMode; label: string }[] = [
  { value: 'cash', label: 'Cash' },
  { value: 'online', label: 'Online' },
];
const STATUS_OPTIONS: { value: FormState['initialStatus']; label: string }[] = [
  { value: 'in_atelier', label: 'In production' },
  { value: 'delivered', label: 'Delivered' },
];

/** Names the atelier writes on every measurement page — offered as an autocomplete list. */
const MEASUREMENT_NAMES = [
  'Shoulder',
  'Chest',
  'Bust',
  'Waist',
  'Hip',
  'Sleeve',
  'Armhole',
  'Neck',
  'Length',
  'Blouse Length',
  'Kurta Length',
  'Bottom Length',
  'Inseam',
];

const toPaise = (rupees: string) => Math.round(Number(rupees) * 100);
const money = (paise: number) => formatINR(Number.isFinite(paise) ? paise : 0);

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
  /**
   * Extra content for the sticky bottom bar, ahead of the totals + actions.
   * The bill wizard hangs its photo strip + toggle here so one sticky region
   * carries both on phones.
   */
  stickyExtra?: ReactNode;
}

/** The shared bill-entry form — used directly at /orders/new and as the review step of /intake. */
export function OrderIntakeForm({
  initial,
  documentIds,
  measurementSets,
  onDone,
  stickyExtra,
}: OrderIntakeFormProps) {
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
  const [errors, setErrors] = useState<FieldErrors>({});
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const errRef = useRef<HTMLDivElement>(null);

  /** Drop one field's error the moment its value changes — no waiting for a resubmit. */
  const clearError = (id: string) =>
    setErrors((all) => {
      if (all[id] === undefined) return all;
      const rest = { ...all };
      delete rest[id];
      return rest;
    });

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
    const id = FIELD_ERROR_IDS[key];
    if (id) clearError(id);
  };

  // Bring API failures into view and announce them — they render next to the actions.
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

  const setItem = (index: number, key: keyof ItemRow, value: string) => {
    setItems((rows) => rows.map((r, i) => (i === index ? { ...r, [key]: value } : r)));
    clearError(`oi-${ITEM_ERROR_KEYS[key]}-${index}`);
  };

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

  /**
   * Same rules the single error banner used to enforce, keyed by input id and
   * inserted in DOM order so the summary jumps to the topmost problem first.
   */
  const validate = (): FieldErrors => {
    const errs: FieldErrors = {};

    if (!linked) {
      if (!normalizePhone(form.phone)) errs['oi-phone'] = 'Enter a valid mobile number';
      if (!form.firstName.trim()) errs['oi-first'] = 'Customer first name is required';
    }

    const named = items.filter((r) => r.description.trim() !== '');
    if (named.length === 0) {
      const blank = items.findIndex((r) => r.description.trim() === '');
      errs[`oi-desc-${blank === -1 ? 0 : blank}`] = 'Add at least one item from the bill';
    } else {
      items.forEach((r, i) => {
        if (r.description.trim() === '') return;
        if (Math.round(Number(r.qty) || 0) < 1) errs[`oi-qty-${i}`] = 'Quantity must be at least 1';
        if (!Number.isFinite(toPaise(r.unitRupees)))
          errs[`oi-unit-${i}`] = 'Enter the price in rupees';
      });
    }

    if (
      !Number.isFinite(totalPaise) ||
      totalPaise < 0 ||
      (form.totalRupees.trim() === '' && subtotalPaise === 0)
    ) {
      errs['oi-total'] = 'Please enter the bill total in rupees';
    } else if (advancePaise > totalPaise) {
      errs['oi-advance'] = 'Advance cannot exceed the total';
    }

    return errs;
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);

    const errs = validate();
    setErrors(errs);
    if (Object.keys(errs).length > 0) {
      scrollToFirstError(errs);
      return;
    }

    const rows = items.filter((r) => r.description.trim() !== '');

    const customer = linked
      ? { action: 'link' as const, userId: linked.id }
      : {
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
      navigate('/orders');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to record the order');
      setBusy(false);
    }
  };

  return (
    <form className="form-card" onSubmit={onSubmit} noValidate>
      <fieldset className="fset">
        <legend>Customer</legend>
        <Field id="oi-phone" label="Phone" error={errors['oi-phone']}>
          {(a11y) => (
            <Input
              {...a11y}
              type="tel"
              inputMode="tel"
              placeholder="98200 12345"
              value={linked ? (linked.phone ?? '') : form.phone}
              disabled={!!linked}
              onChange={(e) => set('phone', e.target.value)}
            />
          )}
        </Field>

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
            <Button fit onClick={() => setLinked(null)}>
              Unlink
            </Button>
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
                <Button fit onClick={() => setLinked(u)}>
                  Link
                </Button>
              </div>
            ))}
            <div className="grid2">
              <Field id="oi-first" label="First Name" error={errors['oi-first']}>
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={form.firstName}
                    onChange={(e) => set('firstName', e.target.value)}
                  />
                )}
              </Field>
              <Field id="oi-last" label="Last Name">
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={form.lastName}
                    onChange={(e) => set('lastName', e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field id="oi-email" label="Email (optional)">
              {(a11y) => (
                <Input
                  {...a11y}
                  type="email"
                  value={form.email}
                  onChange={(e) => set('email', e.target.value)}
                />
              )}
            </Field>
            <Field id="oi-addr1" label="Address (optional)">
              {(a11y) => (
                <Input
                  {...a11y}
                  value={form.addressLine1}
                  onChange={(e) => set('addressLine1', e.target.value)}
                />
              )}
            </Field>
            <div className="grid2">
              <Field id="oi-addr2" label="Address Line 2 (optional)">
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={form.addressLine2}
                    onChange={(e) => set('addressLine2', e.target.value)}
                  />
                )}
              </Field>
              <Field id="oi-city" label="City (optional)">
                {(a11y) => (
                  <Input {...a11y} value={form.city} onChange={(e) => set('city', e.target.value)} />
                )}
              </Field>
            </div>
            <div className="grid2">
              <Field id="oi-state" label="State (optional)">
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={form.stateName}
                    onChange={(e) => set('stateName', e.target.value)}
                  />
                )}
              </Field>
              <Field id="oi-pincode" label="PIN Code (optional)">
                {(a11y) => (
                  <Input
                    {...a11y}
                    inputMode="numeric"
                    maxLength={6}
                    autoComplete="postal-code"
                    value={form.pincode}
                    onChange={(e) => set('pincode', e.target.value)}
                  />
                )}
              </Field>
            </div>
          </>
        )}
      </fieldset>

      <fieldset className="fset">
        <legend>Channel</legend>
        <SegmentedControl
          label="Channel"
          options={CHANNEL_OPTIONS}
          value={form.channel}
          onChange={(v) => set('channel', v)}
        />
      </fieldset>

      <fieldset className="fset">
        <legend>Bill</legend>
        <div className="field">
          <span className="lab">Bill type</span>
          <SegmentedControl
            label="Bill type"
            options={BILL_TYPE_OPTIONS}
            value={form.billType}
            onChange={(v) => set('billType', v)}
          />
        </div>
        <div className="grid2">
          <Field id="oi-billno" label="Bill Number">
            {(a11y) => (
              <Input
                {...a11y}
                value={form.billNumber}
                onChange={(e) => set('billNumber', e.target.value)}
              />
            )}
          </Field>
          {form.billType === 'gst_invoice' && (
            <Field id="oi-gst" label="GST (₹ rupees)">
              {(a11y) => (
                <Input
                  {...a11y}
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={form.gstRupees}
                  onChange={(e) => set('gstRupees', e.target.value)}
                />
              )}
            </Field>
          )}
        </div>
      </fieldset>

      <fieldset className="fset">
        <legend>Items</legend>
        {items.map((row, i) => (
          <div className="item-row" key={i}>
            <div className="f-desc">
              <Field id={`oi-desc-${i}`} label="Description" error={errors[`oi-desc-${i}`]}>
                {(a11y) => (
                  <Input
                    {...a11y}
                    value={row.description}
                    onChange={(e) => setItem(i, 'description', e.target.value)}
                  />
                )}
              </Field>
            </div>
            <Field id={`oi-qty-${i}`} label="Qty" error={errors[`oi-qty-${i}`]}>
              {(a11y) => (
                <Stepper
                  {...a11y}
                  value={row.qty}
                  min={1}
                  label="quantity"
                  onChange={(v) => setItem(i, 'qty', v)}
                />
              )}
            </Field>
            <Field id={`oi-unit-${i}`} label="Unit ₹" error={errors[`oi-unit-${i}`]}>
              {(a11y) => (
                <Input
                  {...a11y}
                  type="number"
                  min="0"
                  inputMode="decimal"
                  value={row.unitRupees}
                  onChange={(e) => setItem(i, 'unitRupees', e.target.value)}
                />
              )}
            </Field>
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
        <Button fit onClick={() => setItems((rows) => [...rows, { ...EMPTY_ITEM }])}>
          + Add Item
        </Button>
      </fieldset>

      <fieldset className="fset">
        <legend>Measurements</legend>
        {msets.map((mset, i) => (
          <KeyValueEditor
            key={i}
            idPrefix={`ms-${i}`}
            set={mset}
            suggestions={MEASUREMENT_NAMES}
            onChange={(next) => setMsets((all) => all.map((s, j) => (j === i ? next : s)))}
            onRemove={() => setMsets((all) => all.filter((_, j) => j !== i))}
          />
        ))}
        <Button fit onClick={() => setMsets((all) => [...all, structuredClone(EMPTY_SET)])}>
          + Add Measurement Set
        </Button>
      </fieldset>

      <fieldset className="fset">
        <legend>Totals</legend>
        <p className="x">Items sum to {money(subtotalPaise)}</p>
        <div className="grid2">
          <Field id="oi-total" label="Bill Total (₹ rupees)" error={errors['oi-total']}>
            {(a11y) => (
              <Input
                {...a11y}
                type="number"
                min="0"
                inputMode="decimal"
                placeholder={String(subtotalPaise / 100)}
                value={form.totalRupees}
                onChange={(e) => set('totalRupees', e.target.value)}
              />
            )}
          </Field>
          <Field id="oi-advance" label="Advance (₹ rupees)" error={errors['oi-advance']}>
            {(a11y) => (
              <Input
                {...a11y}
                type="number"
                min="0"
                inputMode="decimal"
                value={form.advanceRupees}
                onChange={(e) => set('advanceRupees', e.target.value)}
              />
            )}
          </Field>
        </div>
        {totalsMismatch && (
          <p className="parse-note" role="note">
            Bill total is {money(enteredTotalPaise)} but items{gstPaise > 0 ? ' + GST' : ''} sum to{' '}
            {money(subtotalPaise + gstPaise)} — check item prices or GST.
          </p>
        )}
        <div className="field">
          <span className="lab">Advance mode</span>
          <SegmentedControl
            label="Advance mode"
            options={ADVANCE_MODE_OPTIONS}
            value={form.advanceMode}
            onChange={(v) => set('advanceMode', v)}
          />
        </div>
      </fieldset>

      <fieldset className="fset">
        <legend>Delivery</legend>
        <Field id="oi-due" label="Delivery Due Date">
          {(a11y) => (
            <Input
              {...a11y}
              type="date"
              value={form.dueDate}
              onChange={(e) => set('dueDate', e.target.value)}
            />
          )}
        </Field>
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
        <Field id="oi-notes" label="Notes">
          {(a11y) => (
            <Textarea {...a11y} value={form.notes} onChange={(e) => set('notes', e.target.value)} />
          )}
        </Field>
      </fieldset>

      <fieldset className="fset">
        <legend>Order status</legend>
        <SegmentedControl
          label="Order status"
          options={STATUS_OPTIONS}
          value={form.initialStatus}
          onChange={(v) => set('initialStatus', v)}
        />
      </fieldset>

      {error && (
        <div className="form-err" role="alert" tabIndex={-1} ref={errRef}>
          {error}
        </div>
      )}

      <StickyBar error={errorSummary(errors)} onErrorClick={() => scrollToFirstError(errors)}>
        {stickyExtra}
        <div className="sticky-tot">
          <strong>Total {money(totalPaise)}</strong>
          <span className="x">Balance {money(balancePaise)}</span>
        </div>
        <Button variant="gold" fit type="submit" busy={busy}>
          {busy ? 'Recording…' : 'Record Order'}
        </Button>
        <Button fit onClick={() => navigate('/orders')}>
          Cancel
        </Button>
      </StickyBar>
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
