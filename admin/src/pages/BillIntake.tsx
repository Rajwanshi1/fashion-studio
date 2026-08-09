import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { InvoiceActions } from '../components/InvoiceActions';
import type { MeasurementSetState } from '../components/KeyValueEditor';
import ShotTile, { ZoomableShot } from '../components/ShotTile';
import { useToast } from '../components/Toast';
import { formatDate, formatINR } from '../lib/format';
import type { Order } from '../lib/types';
import type { BillDraft, MeasurementDraft } from '../lib/uploads';
import { parseDocument, uploadDocument } from '../lib/uploads';
import { STATUS_MESSAGES, waLink } from '../lib/whatsapp';
import { OrderIntakeForm } from './OrderIntake';
import type { FormState, ItemRow } from './OrderIntake';

type Step = 'capture' | 'review' | 'done';

const STEPS: { key: Step; label: string }[] = [
  { key: 'capture', label: 'Photos' },
  { key: 'review', label: 'Review' },
  { key: 'done', label: 'Done' },
];

type ShotStatus = 'uploading' | 'ready' | 'failed';

/** One captured photo: the original file is kept so a failed upload can be retried. */
interface Shot {
  id: string;
  kind: 'bill' | 'measurement';
  file: File;
  status: ShotStatus;
  documentId?: string;
  previewUrl?: string;
}

let shotSeq = 0;
const shotId = () =>
  typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `shot-${++shotSeq}`;

type DocParse = 'reading' | 'ok' | 'failed';
interface ParseState {
  at: 'idle' | 'running' | 'failed';
  docs: Record<string, DocParse>;
}
const PARSE_IDLE: ParseState = { at: 'idle', docs: {} };

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
  const [shots, setShots] = useState<Shot[]>([]);
  const [parse, setParse] = useState<ParseState>(PARSE_IDLE);

  const [initial, setInitial] = useState<{ form?: Partial<FormState>; items?: ItemRow[] } | undefined>();
  const [msets, setMsets] = useState<MeasurementSetState[]>([]);
  const [parseNote, setParseNote] = useState<string | null>(null);
  const [pageFailures, setPageFailures] = useState(0);
  const [showPhotos, setShowPhotos] = useState(false);
  const [order, setOrder] = useState<Order | null>(null);

  const billCamera = useRef<HTMLInputElement>(null);
  const billGallery = useRef<HTMLInputElement>(null);
  const pageCamera = useRef<HTMLInputElement>(null);
  const pageGallery = useRef<HTMLInputElement>(null);

  const bill = shots.find((s) => s.kind === 'bill');
  const pages = shots.filter((s) => s.kind === 'measurement');
  /** Bill first, then pages — the order photos appear everywhere downstream. */
  const ordered = [...(bill ? [bill] : []), ...pages];
  const ready = ordered.filter((s) => s.status === 'ready');
  const readyPages = ready.filter((s) => s.kind === 'measurement');
  const documentIds = ready.map((s) => s.documentId!);
  const anyUploading = shots.some((s) => s.status === 'uploading');

  // Move focus to the new step's title so keyboard/AT users land where the change is.
  const stepTitleRef = useRef<HTMLHeadingElement>(null);
  const mountedRef = useRef(false);
  useEffect(() => {
    if (!mountedRef.current) {
      mountedRef.current = true;
      return;
    }
    stepTitleRef.current?.focus();
  }, [step, parse.at]);

  const patchShot = (id: string, patch: Partial<Shot>) =>
    setShots((all) => all.map((s) => (s.id === id ? { ...s, ...patch } : s)));

  const runUpload = (shot: Shot) => {
    void uploadDocument(shot.kind, shot.file)
      .then((doc) => patchShot(shot.id, { status: 'ready', documentId: doc.documentId, previewUrl: doc.previewUrl }))
      .catch((err) => {
        patchShot(shot.id, { status: 'failed' });
        toast(err instanceof Error ? err.message : 'Photo upload failed', { tone: 'error' });
      });
  };

  const addFiles = (kind: 'bill' | 'measurement', e: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-selecting the same file (retake)
    if (files.length === 0) return;
    const picked = kind === 'bill' ? files.slice(0, 1) : files;
    const fresh: Shot[] = picked.map((file) => ({ id: shotId(), kind, file, status: 'uploading' }));
    // A new bill photo replaces the old one; measurement pages accumulate.
    setShots((all) => [...(kind === 'bill' ? all.filter((s) => s.kind !== 'bill') : all), ...fresh]);
    fresh.forEach(runUpload);
  };

  const retryUpload = (id: string) => {
    const shot = shots.find((s) => s.id === id);
    if (!shot) return;
    patchShot(id, { status: 'uploading' });
    runUpload(shot);
  };

  /** Parse every uploaded photo in parallel, streaming per-document status into the panel. */
  const parseAll = async () => {
    const billShot = bill;
    if (!billShot || billShot.status !== 'ready' || !billShot.documentId) return;
    const pageShots = readyPages;

    setParse({
      at: 'running',
      docs: Object.fromEntries([billShot, ...pageShots].map((s) => [s.documentId!, 'reading' as DocParse])),
    });
    const mark = (docId: string, status: DocParse) =>
      setParse((p) => ({ ...p, docs: { ...p.docs, [docId]: status } }));

    const [billResult, ...pageResults] = await Promise.allSettled([
      parseDocument<BillDraft>(billShot.documentId).then(
        (v) => {
          mark(billShot.documentId!, 'ok');
          return v;
        },
        (err) => {
          mark(billShot.documentId!, 'failed');
          throw err;
        },
      ),
      ...pageShots.map((p) =>
        parseDocument<MeasurementDraft>(p.documentId!).then(
          (v) => {
            mark(p.documentId!, 'ok');
            return v;
          },
          (err) => {
            mark(p.documentId!, 'failed');
            throw err;
          },
        ),
      ),
    ]);

    setMsets(
      pageResults.flatMap((r, i) =>
        r.status === 'fulfilled' ? [mapMeasurementDraft(r.value, pageShots[i].documentId!)] : [],
      ),
    );
    setPageFailures(pageResults.filter((r) => r.status === 'rejected').length);

    if (billResult.status === 'fulfilled') {
      try {
        setInitial(mapBillDraft(billResult.value));
        setParseNote(billResult.value.confidence_notes?.trim() || null);
      } catch {
        toast('Could not read the parsed bill — enter it manually', { tone: 'error' });
      }
      setParse(PARSE_IDLE);
      setStep('review'); // photos stay attached
    } else {
      // Don't dump the admin on a blank form — offer retry or an explicit manual path.
      setParse((p) => ({ ...p, at: 'failed' }));
    }
  };

  /** The explicit degrade-to-manual path: blank form, photos (and read pages) kept. */
  const continueManually = () => {
    setInitial(undefined);
    setParse(PARSE_IDLE);
    setStep('review');
  };

  const reset = () => {
    setStep('capture');
    setShots([]);
    setParse(PARSE_IDLE);
    setInitial(undefined);
    setMsets([]);
    setParseNote(null);
    setPageFailures(0);
    setShowPhotos(false);
    setOrder(null);
  };

  const waMessage = order ? STATUS_MESSAGES[order.status]?.(order) : undefined;
  const stepIdx = STEPS.findIndex((s) => s.key === step);

  const photoAlt = (s: Shot) => (s.kind === 'bill' ? 'Bill photo' : 'Measurement page');

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The Order Book</span>
        <h1>Scan Bill</h1>
      </div>

      <ol className="wizard-steps" aria-label="Wizard progress">
        {STEPS.map((s, i) => (
          <li
            key={s.key}
            className={i < stepIdx ? 'done' : i === stepIdx ? 'on' : ''}
            aria-current={i === stepIdx ? 'step' : undefined}
          >
            {s.label}
            {i < stepIdx && <span className="sr-only"> (completed)</span>}
          </li>
        ))}
      </ol>

      {step === 'capture' && parse.at === 'idle' && (
        <div className="capture form-card">
          <input
            ref={billCamera}
            type="file"
            accept="image/*,.heic,.heif"
            capture="environment"
            hidden
            aria-label="Bill photo file"
            onChange={(e) => addFiles('bill', e)}
          />
          <input
            ref={billGallery}
            type="file"
            accept="image/*,.heic,.heif"
            hidden
            aria-label="Bill photo from gallery"
            onChange={(e) => addFiles('bill', e)}
          />
          <input
            ref={pageCamera}
            type="file"
            accept="image/*,.heic,.heif"
            capture="environment"
            hidden
            aria-label="Measurement page file"
            onChange={(e) => addFiles('measurement', e)}
          />
          <input
            ref={pageGallery}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            hidden
            aria-label="Measurement pages from gallery"
            onChange={(e) => addFiles('measurement', e)}
          />

          <header className="step-head">
            <h2 className="step-title" tabIndex={-1} ref={stepTitleRef}>
              Photograph the bill
            </h2>
            <p className="hint">
              Lay the bill flat in good light. Add every measurement page — they are read into the
              order automatically.
            </p>
          </header>

          <section className="capture-sec">
            <h3 className="fset-legend">Bill</h3>
            {!bill ? (
              <>
                <button type="button" className="shot-add lg" onClick={() => billCamera.current?.click()}>
                  Take bill photo
                </button>
                <button
                  type="button"
                  className="ulink"
                  aria-label="Choose bill from gallery"
                  onClick={() => billGallery.current?.click()}
                >
                  Choose from gallery
                </button>
              </>
            ) : (
              <>
                <div className="shot-grid">
                  <ShotTile
                    status={bill.status}
                    previewUrl={bill.previewUrl}
                    caption="Bill"
                    alt="Bill photo"
                    onRetry={bill.status === 'failed' ? () => retryUpload(bill.id) : undefined}
                  />
                </div>
                <div className="capture-acts">
                  <button type="button" className="btn-outline fit" onClick={() => billCamera.current?.click()}>
                    Retake bill photo
                  </button>
                  <button
                    type="button"
                    className="ulink"
                    aria-label="Choose bill from gallery"
                    onClick={() => billGallery.current?.click()}
                  >
                    Choose from gallery
                  </button>
                </div>
              </>
            )}
          </section>

          <section className="capture-sec">
            <h3 className="fset-legend">
              Measurement pages <span className="x">optional</span>
            </h3>
            <div className="shot-grid">
              {pages.map((p, i) => (
                <ShotTile
                  key={p.id}
                  status={p.status}
                  previewUrl={p.previewUrl}
                  caption={`Page ${i + 1}`}
                  alt={`Measurement page ${i + 1}`}
                  onRetry={p.status === 'failed' ? () => retryUpload(p.id) : undefined}
                  onRemove={() => setShots((all) => all.filter((s) => s.id !== p.id))}
                />
              ))}
              <button type="button" className="shot-add" onClick={() => pageCamera.current?.click()}>
                <span aria-hidden="true">＋</span> Add measurement page
              </button>
            </div>
            <button
              type="button"
              className="ulink"
              aria-label="Choose measurement pages from gallery"
              onClick={() => pageGallery.current?.click()}
            >
              Choose from gallery
            </button>
          </section>

          <div className="form-actions">
            <button
              type="button"
              className="btn-buy gold fit"
              disabled={!bill || bill.status !== 'ready' || anyUploading}
              onClick={() => void parseAll()}
            >
              Parse bill
            </button>
            <button type="button" className="ulink" onClick={continueManually}>
              Enter manually instead
            </button>
          </div>
        </div>
      )}

      {step === 'capture' && parse.at !== 'idle' && (
        <div className="form-card parse-panel">
          <header className="step-head">
            <h2 className="step-title" tabIndex={-1} ref={stepTitleRef}>
              Reading the bill
            </h2>
            <p className="hint">Usually takes 10–20 seconds. Keep this page open.</p>
          </header>
          <ul className="parse-list" role="status" aria-live="polite">
            {ready
              .filter((s) => parse.docs[s.documentId!])
              .map((s) => {
                const st = parse.docs[s.documentId!];
                const label = s.kind === 'bill' ? 'Bill' : `Measurement page ${readyPages.indexOf(s) + 1}`;
                return (
                  <li key={s.documentId} className={st === 'ok' ? 'ok' : st === 'failed' ? 'fail' : ''}>
                    {st === 'reading' ? (
                      <span className="spin" aria-hidden="true" />
                    ) : (
                      <span aria-hidden="true">{st === 'ok' ? '✓' : '✕'}</span>
                    )}
                    {label} — {st === 'reading' ? 'Reading…' : st === 'ok' ? 'Read' : 'Couldn’t read'}
                  </li>
                );
              })}
          </ul>
          {parse.at === 'failed' && (
            <>
              <div className="form-err" role="alert">
                Couldn’t read the bill photo. Try again, or type the bill in yourself — the photos
                stay attached either way.
              </div>
              <div className="form-actions">
                <button type="button" className="btn-buy gold fit" onClick={() => void parseAll()}>
                  Try again
                </button>
                <button type="button" className="btn-outline fit" onClick={continueManually}>
                  Continue manually
                </button>
              </div>
            </>
          )}
        </div>
      )}

      {step === 'review' && (
        <div className="review-grid">
          <div className="review-main">
            <header className="step-head">
              <h2 className="step-title" tabIndex={-1} ref={stepTitleRef}>
                Review &amp; record
              </h2>
            </header>
            {parseNote && (
              <div className="parse-note" role="note">
                <strong>Check against the photo:</strong> {parseNote}
              </div>
            )}
            {pageFailures > 0 && (
              <div className="parse-note" role="note">
                {pageFailures === 1 ? 'One measurement page' : `${pageFailures} measurement pages`}{' '}
                couldn’t be read — add the measurements by hand below.
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
            {ready.length > 0 && (
              <div className="peek">
                <button
                  type="button"
                  className="btn-outline"
                  aria-expanded={showPhotos}
                  onClick={() => setShowPhotos((v) => !v)}
                >
                  {showPhotos ? 'Hide photos' : `View photos (${ready.length})`}
                </button>
                {showPhotos && (
                  <div className="peek-body">
                    {ready.map((s) => (
                      <ZoomableShot key={s.id} src={s.previewUrl!} alt={photoAlt(s)} />
                    ))}
                  </div>
                )}
              </div>
            )}
          </div>
          {ready.length > 0 && (
            <aside className="photo-rail" aria-label="Bill photos">
              {ready.map((s) => (
                <ZoomableShot key={s.id} src={s.previewUrl!} alt={photoAlt(s)} />
              ))}
            </aside>
          )}
        </div>
      )}

      {step === 'done' && order && (
        <div className="form-card done-card">
          <p className="section-label">Recorded</p>
          <h2 tabIndex={-1} ref={stepTitleRef}>
            {order.orderNumber}
          </h2>
          <dl className="done-meta">
            <div>
              <dt>Customer</dt>
              <dd>
                {order.firstName} {order.lastName}
              </dd>
            </div>
            <div>
              <dt>Total</dt>
              <dd>{formatINR(order.total)}</dd>
            </div>
            {order.balance > 0 && (
              <div>
                <dt>Balance due</dt>
                <dd>{formatINR(order.balance)}</dd>
              </div>
            )}
            {order.deliveryDueDate && (
              <div>
                <dt>Delivery due</dt>
                <dd>{formatDate(order.deliveryDueDate)}</dd>
              </div>
            )}
          </dl>
          <div className="form-actions">
            <InvoiceActions order={order} onUpdated={setOrder} />
            {order.phone && waMessage && (
              <a className="btn-buy gold fit" href={waLink(order.phone, waMessage)} target="_blank" rel="noreferrer">
                Send WhatsApp confirmation
              </a>
            )}
            <button type="button" className="btn-buy fit" onClick={() => navigate(`/orders?focus=${order.id}`)}>
              Open order
            </button>
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
