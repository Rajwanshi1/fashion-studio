import { useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MeasurementSetState } from '../components/KeyValueEditor';
import { useToast } from '../components/Toast';
import type { Order } from '../lib/types';
import type { BillDraft, MeasurementDraft, UploadedDocument } from '../lib/uploads';
import { parseDocument, uploadDocument } from '../lib/uploads';
import { STATUS_MESSAGES, waLink } from '../lib/whatsapp';
import { OrderIntakeForm } from './OrderIntake';
import type { FormState, ItemRow } from './OrderIntake';

type Step = 'capture' | 'review' | 'done';

const num = (n: number | null | undefined) => (n == null ? '' : String(n));
const str = (s: string | null | undefined) => s ?? '';

/** Bill draft → form prefill. Rupees stay rupees — the form converts to paise on submit. */
function mapBillDraft(draft: BillDraft): { form: Partial<FormState>; items?: ItemRow[] } {
  const name = str(draft.customer?.name).trim();
  const spaceAt = name.indexOf(' ');
  const form: Partial<FormState> = {
    phone: str(draft.customer?.phone),
    firstName: spaceAt === -1 ? name : name.slice(0, spaceAt),
    lastName: spaceAt === -1 ? '' : name.slice(spaceAt + 1),
    email: str(draft.customer?.email),
    addressLine1: str(draft.customer?.address),
    city: str(draft.customer?.city),
    stateName: str(draft.customer?.state),
    pincode: str(draft.customer?.pincode),
    billNumber: str(draft.bill?.bill_number),
    gstRupees: num(draft.totals?.gst_rupees),
    totalRupees: num(draft.totals?.total_rupees),
    advanceRupees: num(draft.totals?.advance_rupees),
    dueDate: str(draft.delivery?.due_date),
  };
  if (draft.bill?.bill_type) form.billType = draft.bill.bill_type;
  if (draft.bill?.channel_guess) form.channel = draft.bill.channel_guess;
  if (draft.totals?.advance_mode) form.advanceMode = draft.totals.advance_mode;

  const items = (draft.items ?? [])
    .filter((it) => (it.description ?? '').trim() !== '')
    .map(
      (it): ItemRow => ({
        description: it.description,
        qty: it.quantity != null ? String(it.quantity) : '1',
        unitRupees:
          it.unit_price_rupees != null
            ? String(it.unit_price_rupees)
            : (it.quantity == null || it.quantity === 1) && it.line_total_rupees != null
              ? String(it.line_total_rupees)
              : '',
      }),
    );
  return { form, items: items.length ? items : undefined };
}

function mapMeasurementDraft(draft: MeasurementDraft, documentId: string): MeasurementSetState {
  return {
    label: [draft.garment, draft.person_name].filter(Boolean).join(' — '),
    rows: (draft.measurements ?? []).map((m) => ({ name: m.name, value: m.value })),
    notes: str(draft.notes),
    documentId,
  };
}

/** Mobile-first 3-step wizard: photograph the bill → review the Claude draft → done. */
export default function BillIntake() {
  const navigate = useNavigate();
  const toast = useToast();

  const [step, setStep] = useState<Step>('capture');
  const [bill, setBill] = useState<UploadedDocument | null>(null);
  const [pages, setPages] = useState<UploadedDocument[]>([]);
  const [busyCount, setBusyCount] = useState(0);
  const [parsing, setParsing] = useState(false);

  const [initial, setInitial] = useState<{ form?: Partial<FormState>; items?: ItemRow[] } | undefined>();
  const [msets, setMsets] = useState<MeasurementSetState[]>([]);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [showPhotos, setShowPhotos] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);

  const billInput = useRef<HTMLInputElement>(null);
  const pageInput = useRef<HTMLInputElement>(null);

  const shots = [...(bill ? [bill] : []), ...pages];
  const documentIds = shots.map((s) => s.documentId);
  const busy = busyCount > 0 || parsing;

  const capture = async (kind: 'bill' | 'measurement', e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file (retake)
    if (!file) return;
    setBusyCount((n) => n + 1);
    try {
      const shot = await uploadDocument(kind, file);
      if (kind === 'bill') setBill(shot);
      else setPages((all) => [...all, shot]);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Photo upload failed');
    } finally {
      setBusyCount((n) => n - 1);
    }
  };

  /** Parse every uploaded photo in parallel; any failure falls back to a blank review. */
  const parseAll = async () => {
    if (!bill) return;
    setParsing(true);
    const [billResult, ...pageResults] = await Promise.allSettled([
      parseDocument<BillDraft>(bill.documentId),
      ...pages.map((p) => parseDocument<MeasurementDraft>(p.documentId)),
    ]);

    if (billResult.status === 'fulfilled') {
      try {
        setInitial(mapBillDraft(billResult.value));
        setParseNote(billResult.value.confidence_notes?.trim() || null);
      } catch {
        toast('Could not read the parsed bill — enter it manually');
      }
    } else {
      const reason = billResult.reason;
      toast(reason instanceof Error ? reason.message : 'Parsing failed — enter the bill manually');
    }
    setMsets(
      pageResults.flatMap((r, i) =>
        r.status === 'fulfilled' ? [mapMeasurementDraft(r.value, pages[i].documentId)] : [],
      ),
    );
    setParsing(false);
    setStep('review'); // photos stay attached either way
  };

  const reset = () => {
    setStep('capture');
    setBill(null);
    setPages([]);
    setInitial(undefined);
    setMsets([]);
    setParseNote(null);
    setShowPhotos(false);
    setOrder(null);
  };

  const waMessage = order ? STATUS_MESSAGES[order.status]?.(order) : undefined;

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The Order Book</span>
        <h1>Scan Bill</h1>
      </div>

      <ol className="wizard-steps" aria-label="Wizard progress">
        <li className={step === 'capture' ? 'on' : ''}>Photos</li>
        <li className={step === 'review' ? 'on' : ''}>Review</li>
        <li className={step === 'done' ? 'on' : ''}>Done</li>
      </ol>

      {step === 'capture' && (
        <div className="capture form-card">
          <input
            ref={billInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            aria-label="Bill photo file"
            onChange={(e) => void capture('bill', e)}
          />
          <input
            ref={pageInput}
            type="file"
            accept="image/*"
            capture="environment"
            hidden
            aria-label="Measurement page file"
            onChange={(e) => void capture('measurement', e)}
          />

          <button type="button" className="btn-buy gold" disabled={busy} onClick={() => billInput.current?.click()}>
            {bill ? 'Retake bill photo' : 'Bill photo'}
          </button>
          {bill && (
            <div className="thumbs">
              <figure className="thumb">
                <img src={bill.previewUrl} alt="Bill photo" />
                <figcaption>Bill</figcaption>
              </figure>
            </div>
          )}

          <button type="button" className="btn-outline" disabled={busy} onClick={() => pageInput.current?.click()}>
            + Measurement page{pages.length > 0 ? ` (${pages.length})` : ''}
          </button>
          {pages.length > 0 && (
            <div className="thumbs">
              {pages.map((p, i) => (
                <figure className="thumb" key={p.documentId}>
                  <img src={p.previewUrl} alt={`Measurement page ${i + 1}`} />
                  <figcaption>
                    Page {i + 1}
                    <button
                      type="button"
                      className="ulink"
                      onClick={() => setPages((all) => all.filter((x) => x.documentId !== p.documentId))}
                    >
                      Remove
                    </button>
                  </figcaption>
                </figure>
              ))}
            </div>
          )}

          <button type="button" className="btn-buy" disabled={!bill || busy} onClick={() => void parseAll()}>
            {parsing ? 'Reading the bill…' : busyCount > 0 ? 'Uploading…' : 'Parse'}
          </button>
          <button type="button" className="ulink" onClick={() => setStep('review')}>
            Enter manually instead
          </button>
        </div>
      )}

      {step === 'review' && (
        <>
          {parseNote && (
            <div className="parse-note" role="note">
              <strong>Check against the photo:</strong> {parseNote}
            </div>
          )}
          <OrderIntakeForm
            initial={initial}
            documentIds={documentIds}
            measurementSets={msets}
            onDone={(created) => {
              setOrder(created);
              setStep('done');
            }}
          />
          {shots.length > 0 && (
            <div className="peek">
              <button type="button" className="btn-outline" onClick={() => setShowPhotos((v) => !v)}>
                {showPhotos ? 'Hide photos' : `View photos (${shots.length})`}
              </button>
              {showPhotos && (
                <div className="peek-body">
                  {shots.map((s) => (
                    <img key={s.documentId} src={s.previewUrl} alt={s.kind === 'bill' ? 'Bill photo' : 'Measurement page'} />
                  ))}
                </div>
              )}
            </div>
          )}
        </>
      )}

      {step === 'done' && order && (
        <div className="form-card done-card">
          <p className="section-label">Recorded</p>
          <h2>{order.orderNumber}</h2>
          <p className="x">
            {order.firstName} {order.lastName} · ₹{(order.total / 100).toLocaleString('en-IN')}
          </p>
          <div className="form-actions">
            {order.phone && waMessage && (
              <a className="btn-buy gold fit" href={waLink(order.phone, waMessage)} target="_blank" rel="noreferrer">
                Send WhatsApp confirmation
              </a>
            )}
            <button type="button" className="btn-outline fit" onClick={reset}>
              Scan next bill
            </button>
            <button type="button" className="btn-outline fit" onClick={() => navigate('/orders')}>
              View orders
            </button>
          </div>
        </div>
      )}
    </>
  );
}
