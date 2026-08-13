/**
 * Per-section editor for the storefront content, reached from /site.
 *
 * One schema-driven form serves all eight sections: SECTIONS supplies the field
 * list, SECTION_DEFAULTS the built-in copy, and the field's `type` picks the
 * control. Two rules shape everything here:
 *
 *  1. The form opens on the section's *effective* content — the storefront's
 *     own merge applied to whatever the API stored (blank/missing loses to the
 *     default, see frontend/src/lib/content.tsx). The boutique edits what the
 *     site shows, never a blank form.
 *  2. A save PUTs the whole section. The backend schemas are `.strict()` and
 *     per-field, so a partial body would silently drop the rest.
 */
import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, KeyboardEvent, MouseEvent } from 'react';
import { Navigate, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { uploadProductImage } from '../lib/uploads';
import { useToast } from '../components/Toast';
import ConfirmModal from '../components/ConfirmModal';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import { SECTIONS, SECTION_DEFAULTS } from '../lib/siteContent';
import type {
  ArchiveVolumeContent,
  FieldConfig,
  LookContent,
  SectionConfig,
  TrustItemContent,
} from '../lib/siteContent';
import DeviceToggle from '../preview/DeviceToggle';
import SectionLivePreview from '../preview/SectionLivePreview';
import type { PreviewDevice } from '../preview/PreviewFrame';

// The one shape both the form and the previews speak — siteContent.ts owns it.
type TrustItem = TrustItemContent;
type Look = LookContent;
type Volume = ArchiveVolumeContent;

type FormState = Record<string, unknown>;

/** Mirrors the backend's `str`/`copy`/`url` caps so a long paste can't 400. */
const TEXT_MAX = 300;
const COPY_MAX = 1000;
const URL_MAX = 500;

/**
 * Prod sits behind a CloudFront WAF that answers any request body over 8KB
 * with an opaque edge 403 — no API error body, nothing in the app logs. The
 * API refuses the same 6KB budget with a readable 400, but the WAF fires
 * first, so the section is measured here as well and never leaves the browser.
 * Keep in step with MAX_SECTION_BYTES in backend/src/routes/content.routes.ts.
 */
const MAX_SECTION_BYTES = 6 * 1024;

/**
 * The schemas type every `…Url` / `…Href` field as `url` (500) and everything
 * else as `str` (300) — the names carry the distinction, so the field configs
 * don't have to.
 */
function maxLengthFor(name: string): number {
  return /(Url|Href)$/.test(name) ? URL_MAX : TEXT_MAX;
}

/** Fixed counts the schemas insist on. */
const TRUST_COUNT = 3;
const LOOK_COUNT = 7;
/** The archive grows a volume per season; the schema caps the list at 6. */
const VOLUME_MAX = 6;

/** The two looks the storefront prints a caption under. */
const CAPTIONED_LOOKS = new Set([0, 3]);

/** Per-section caps and row wording for the `stringList` fields. */
const LIST_MAX: Record<string, number> = { marquee: 8, ticker: 8, lookbookCover: 4 };
const LIST_NOUN: Record<string, string> = {
  marquee: 'Line',
  ticker: 'Message',
  lookbookCover: 'Sub-line',
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/* ---- Stored value ← default, exactly as the storefront merges them ---- */

function mergeStr(stored: unknown, fallback: unknown): string {
  if (typeof stored === 'string' && stored.trim() !== '') return stored;
  return typeof fallback === 'string' ? fallback : '';
}

function mergeImg(stored: unknown, fallback: unknown): string | null {
  if (typeof stored === 'string' && stored.trim() !== '') return stored;
  return typeof fallback === 'string' && fallback.trim() !== '' ? fallback : null;
}

/** An integer percent for object-position — whatever arrives, 0–100 leaves. */
function clampPct(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Focal points: a finite stored number wins (clamped); junk falls back to 50. */
function mergeNum(stored: unknown, fallback: unknown): number {
  if (typeof stored === 'number' && Number.isFinite(stored)) return clampPct(stored);
  return typeof fallback === 'number' ? fallback : 50;
}

/** Lists are replaced wholesale — an all-blank list falls back to the default. */
function mergeList(stored: unknown, fallback: unknown): string[] {
  const defaults = Array.isArray(fallback)
    ? fallback.filter((x): x is string => typeof x === 'string')
    : [];
  if (!Array.isArray(stored)) return defaults;
  const items = stored.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  return items.length > 0 ? items : defaults;
}

function mergeTrust(stored: unknown, fallback: unknown): TrustItem[] {
  const defaults = Array.isArray(fallback) ? fallback : [];
  const rows = Array.isArray(stored) ? stored : [];
  return Array.from({ length: TRUST_COUNT }, (_, i) => {
    const row = isRecord(rows[i]) ? rows[i] : {};
    const def = isRecord(defaults[i]) ? defaults[i] : {};
    return { title: mergeStr(row.title, def.title), detail: mergeStr(row.detail, def.detail) };
  });
}

function mergeLooks(stored: unknown, fallback: unknown): Look[] {
  const defaults = Array.isArray(fallback) ? fallback : [];
  const rows = Array.isArray(stored) ? stored : [];
  return Array.from({ length: LOOK_COUNT }, (_, i) => {
    const row = isRecord(rows[i]) ? rows[i] : {};
    const def = isRecord(defaults[i]) ? defaults[i] : {};
    return {
      imageUrl: mergeImg(row.imageUrl, def.imageUrl),
      focusX: mergeNum(row.focusX, def.focusX),
      focusY: mergeNum(row.focusY, def.focusY),
      lookNo: mergeStr(row.lookNo, def.lookNo),
      title: mergeStr(row.title, def.title),
      copy: mergeStr(row.copy, def.copy),
      ctaHref: mergeStr(row.ctaHref, def.ctaHref),
    };
  });
}

/** Volumes are not a fixed count — the archive only grows. Rows past the
 *  defaults are kept as stored (merged over an empty volume). */
function mergeVolumes(stored: unknown, fallback: unknown): Volume[] {
  const defaults = Array.isArray(fallback) ? fallback : [];
  const rows = Array.isArray(stored) ? stored : [];
  const length = Math.max(defaults.length, rows.length);
  return Array.from({ length }, (_, i) => {
    const row = isRecord(rows[i]) ? rows[i] : {};
    const def = isRecord(defaults[i]) ? defaults[i] : {};
    return {
      imageUrl: mergeImg(row.imageUrl, def.imageUrl),
      focusX: mergeNum(row.focusX, def.focusX),
      focusY: mergeNum(row.focusY, def.focusY),
      volumeNo: mergeStr(row.volumeNo, def.volumeNo),
      title: mergeStr(row.title, def.title),
      season: mergeStr(row.season, def.season),
      copy: mergeStr(row.copy, def.copy),
      collections: mergeList(row.collections, def.collections),
      status: mergeStr(row.status, def.status),
    };
  });
}

/** Effective content for one section, ready to edit. */
function buildForm(config: SectionConfig, stored: Record<string, unknown> | null): FormState {
  // Widened: the form reads fields by dynamic name, off the schema config.
  const defaults: Record<string, unknown> = SECTION_DEFAULTS[config.key];
  const form: FormState = {};
  for (const field of config.fields) {
    const value = stored?.[field.name];
    const fallback = defaults[field.name];
    switch (field.type) {
      case 'image':
        form[field.name] = mergeImg(value, fallback);
        // The photo's focal point rides beside it as sibling form keys.
        if (field.focus) {
          form.focusX = mergeNum(stored?.focusX, defaults.focusX);
          form.focusY = mergeNum(stored?.focusY, defaults.focusY);
        }
        break;
      case 'stringList':
        form[field.name] = mergeList(value, fallback);
        break;
      case 'trustItems':
        form[field.name] = mergeTrust(value, fallback);
        break;
      case 'looks':
        form[field.name] = mergeLooks(value, fallback);
        break;
      case 'volumes':
        form[field.name] = mergeVolumes(value, fallback);
        break;
      default:
        form[field.name] = mergeStr(value, fallback);
    }
  }
  return form;
}

/* ---- Typed reads off the (deliberately loose) form bag ---- */

const strOf = (form: FormState, name: string): string =>
  typeof form[name] === 'string' ? (form[name] as string) : '';

const imgOf = (form: FormState, name: string): string | null =>
  typeof form[name] === 'string' && form[name] !== '' ? (form[name] as string) : null;

const listOf = (form: FormState, name: string): string[] =>
  Array.isArray(form[name]) ? (form[name] as string[]) : [];

const trustOf = (form: FormState, name: string): TrustItem[] =>
  Array.isArray(form[name]) ? (form[name] as TrustItem[]) : [];

const looksOf = (form: FormState, name: string): Look[] =>
  Array.isArray(form[name]) ? (form[name] as Look[]) : [];

const volumesOf = (form: FormState, name: string): Volume[] =>
  Array.isArray(form[name]) ? (form[name] as Volume[]) : [];

const pctOf = (form: FormState, name: string): number => {
  const value = form[name];
  return typeof value === 'number' && Number.isFinite(value) ? clampPct(value) : 50;
};

/** The full section body — only the configured field names, strictly shaped. */
function payload(config: SectionConfig, form: FormState): Record<string, unknown> {
  const body: Record<string, unknown> = {};
  const max = LIST_MAX[config.key] ?? 8;
  for (const field of config.fields) {
    switch (field.type) {
      case 'image':
        body[field.name] = imgOf(form, field.name);
        if (field.focus) {
          body.focusX = pctOf(form, 'focusX');
          body.focusY = pctOf(form, 'focusY');
        }
        break;
      case 'stringList':
        // Blank rows are a UI convenience; the schema rejects empty strings.
        body[field.name] = listOf(form, field.name)
          .map((item) => item.trim())
          .filter((item) => item !== '')
          .slice(0, max);
        break;
      case 'trustItems':
        body[field.name] = trustOf(form, field.name)
          .slice(0, TRUST_COUNT)
          .map(({ title, detail }) => ({ title, detail }));
        break;
      case 'looks':
        body[field.name] = looksOf(form, field.name)
          .slice(0, LOOK_COUNT)
          .map(({ imageUrl, focusX, focusY, lookNo, title, copy, ctaHref }) => ({
            imageUrl,
            focusX: clampPct(focusX),
            focusY: clampPct(focusY),
            lookNo,
            title,
            copy,
            ctaHref,
          }));
        break;
      case 'volumes':
        body[field.name] = volumesOf(form, field.name)
          .slice(0, VOLUME_MAX)
          .map(({ imageUrl, focusX, focusY, volumeNo, title, season, copy, collections, status }) => ({
            imageUrl,
            focusX: clampPct(focusX),
            focusY: clampPct(focusY),
            volumeNo,
            title,
            season,
            copy,
            collections: collections.map((c) => c.trim()).filter((c) => c !== ''),
            status,
          }));
        break;
      default:
        body[field.name] = strOf(form, field.name);
    }
  }
  return body;
}

function swap<T>(items: T[], from: number, to: number): T[] {
  if (to < 0 || to >= items.length) return items;
  const next = [...items];
  [next[from], next[to]] = [next[to], next[from]];
  return next;
}

/* ---- Controls ---- */

/** Grows with its content — captions run long and phones have no scrollbars. */
function AutoTextarea({
  id,
  value,
  maxLength,
  onChange,
}: {
  id: string;
  value: string;
  maxLength: number;
  onChange: (value: string) => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    if (el.scrollHeight > 0) el.style.height = `${el.scrollHeight}px`;
  }, [value]);
  return (
    <textarea
      ref={ref}
      id={id}
      className="inp"
      rows={3}
      maxLength={maxLength}
      value={value}
      onChange={(e) => onChange(e.target.value)}
    />
  );
}

function TextField({
  id,
  label,
  hint,
  value,
  multiline,
  maxLength,
  onChange,
}: {
  id: string;
  label: string;
  hint?: string;
  value: string;
  multiline?: boolean;
  maxLength?: number;
  onChange: (value: string) => void;
}) {
  return (
    <div className="field">
      <label className="lab" htmlFor={id}>
        {label}
      </label>
      {multiline ? (
        <AutoTextarea id={id} value={value} maxLength={COPY_MAX} onChange={onChange} />
      ) : (
        <input
          id={id}
          className="inp"
          maxLength={maxLength ?? TEXT_MAX}
          value={value}
          onChange={(e) => onChange(e.target.value)}
        />
      )}
      {hint && <p className="hint">{hint}</p>}
    </div>
  );
}

/** How far one arrow-key press moves the focal point, in percent. */
const FOCAL_STEP = 5;

/**
 * The focal-point picker: the photo at its natural aspect, a crosshair where
 * the current focal point sits. A tap moves it; arrow keys nudge it. The
 * *uncropped* photo is the right input surface — the point of the control is
 * choosing what survives the storefront's object-fit: cover crop, and the
 * subject may be outside today's crop entirely. The live preview beside the
 * form shows the resulting crop as it moves.
 */
function FocalPointField({
  src,
  noun,
  focusX,
  focusY,
  onChange,
}: {
  src: string;
  noun: string;
  focusX: number;
  focusY: number;
  onChange: (focusX: number, focusY: number) => void;
}) {
  const button = useRef<HTMLButtonElement>(null);

  const onPick = (e: MouseEvent<HTMLButtonElement>) => {
    // Enter/Space synthesize a click at clientX/Y 0 (detail 0) — without this
    // guard a keyboard activation silently snaps a saved crop to the top-left
    // corner. Arrows are the keyboard path.
    if (e.detail === 0) return;
    const rect = button.current?.getBoundingClientRect();
    if (!rect || rect.width === 0 || rect.height === 0) return;
    onChange(
      clampPct(((e.clientX - rect.left) / rect.width) * 100),
      clampPct(((e.clientY - rect.top) / rect.height) * 100),
    );
  };

  const onKey = (e: KeyboardEvent<HTMLButtonElement>) => {
    const nudge: Record<string, [number, number]> = {
      ArrowLeft: [-FOCAL_STEP, 0],
      ArrowRight: [FOCAL_STEP, 0],
      ArrowUp: [0, -FOCAL_STEP],
      ArrowDown: [0, FOCAL_STEP],
    };
    const delta = nudge[e.key];
    if (!delta) return;
    e.preventDefault();
    onChange(clampPct(focusX + delta[0]), clampPct(focusY + delta[1]));
  };

  return (
    <div className="focal-wrap">
      <button
        ref={button}
        type="button"
        className="focal-pick"
        aria-label={`Focal point for ${noun}: ${focusX}% across, ${focusY}% down. Tap the photo or use the arrow keys.`}
        onClick={onPick}
        onKeyDown={onKey}
      >
        <img src={src} alt="" />
        <span className="focal-dot" style={{ left: `${focusX}%`, top: `${focusY}%` }} aria-hidden="true" />
      </button>
      <p className="hint">Focal point — tap what the photo must keep in frame.</p>
    </div>
  );
}

/**
 * A photo tile plus a hidden file input. No product to name the object after,
 * so `uploadProductImage` presigns a plain uuid key.
 *
 * The upload is reported up through `onUploading` as well as kept locally: the
 * page has to hold Save until every tile has finished, or a phone-sized
 * picker→Save gesture would PUT the old URL and drop the photo on the floor.
 */
function ImageField({
  label,
  hint,
  value,
  focusX,
  focusY,
  onFocusChange,
  onUploading,
  onChange,
}: {
  label: string;
  hint?: string;
  value: string | null;
  /** Present only for photos that carry a focal point (FieldConfig.focus). */
  focusX?: number;
  focusY?: number;
  onFocusChange?: (focusX: number, focusY: number) => void;
  onUploading: (uploading: boolean) => void;
  onChange: (value: string | null) => void;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  // Accessible names carry the label so the lookbook's seven photo fields stay
  // distinguishable; the visible wording stays short.
  const noun = label.toLowerCase();

  const onPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-picking the same file (retake)
    if (!file) return;
    setBusy(true);
    onUploading(true);
    try {
      const { publicUrl } = await uploadProductImage(file);
      onChange(publicUrl);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Photo upload failed', { tone: 'error' });
    } finally {
      setBusy(false);
      onUploading(false);
    }
  };

  return (
    <div className="field">
      <span className="lab">{label}</span>
      <div className="img-field">
        {value ? (
          <img className={`img-tile${busy ? ' busy' : ''}`} src={value} alt={label} />
        ) : (
          <span className={`img-tile mono${busy ? ' busy' : ''}`} aria-hidden="true">
            ＋
          </span>
        )}
        <div className="img-actions">
          <button
            type="button"
            className="btn-outline fit"
            aria-label={`${value ? 'Replace' : 'Add'} ${noun}`}
            disabled={busy}
            onClick={() => input.current?.click()}
          >
            {busy ? 'Uploading…' : value ? 'Replace photo' : 'Add photo'}
          </button>
          {value && (
            <button
              type="button"
              className="ulink"
              aria-label={`Remove ${noun}`}
              disabled={busy}
              onClick={() => onChange(null)}
            >
              Remove photo
            </button>
          )}
        </div>
      </div>
      {hint && <p className="hint">{hint}</p>}
      {value && onFocusChange && (
        <FocalPointField
          src={value}
          noun={noun}
          focusX={focusX ?? 50}
          focusY={focusY ?? 50}
          onChange={onFocusChange}
        />
      )}
      <input
        ref={input}
        type="file"
        accept="image/*,.heic,.heif"
        hidden
        aria-label={`${label} file`}
        onChange={(e) => void onPicked(e)}
      />
    </div>
  );
}

function ListField({
  label,
  hint,
  noun,
  max,
  items,
  onChange,
}: {
  label: string;
  hint?: string;
  noun: string;
  max: number;
  items: string[];
  onChange: (items: string[]) => void;
}) {
  const lower = noun.toLowerCase();
  return (
    <div className="field">
      <span className="lab">{label}</span>
      {hint && <p className="hint">{hint}</p>}
      <div className="row-list">
        {items.map((item, i) => (
          // Index keys are right here: a row is nothing but its (controlled) value.
          <div className="row-item" key={i}>
            <input
              className="inp"
              aria-label={`${noun} ${i + 1}`}
              maxLength={TEXT_MAX}
              value={item}
              onChange={(e) => onChange(items.map((x, j) => (j === i ? e.target.value : x)))}
            />
            <button
              type="button"
              className="row-btn"
              aria-label={`Move ${lower} ${i + 1} up`}
              disabled={i === 0}
              onClick={() => onChange(swap(items, i, i - 1))}
            >
              ↑
            </button>
            <button
              type="button"
              className="row-btn"
              aria-label={`Move ${lower} ${i + 1} down`}
              disabled={i === items.length - 1}
              onClick={() => onChange(swap(items, i, i + 1))}
            >
              ↓
            </button>
            <button
              type="button"
              className="row-btn"
              aria-label={`Remove ${lower} ${i + 1}`}
              onClick={() => onChange(items.filter((_, j) => j !== i))}
            >
              ✕
            </button>
          </div>
        ))}
      </div>
      {items.length < max && (
        <button
          type="button"
          className="btn-outline fit row-add"
          onClick={() => onChange([...items, ''])}
        >
          Add {lower}
        </button>
      )}
    </div>
  );
}

function TrustField({
  label,
  hint,
  items,
  onChange,
}: {
  label: string;
  hint?: string;
  items: TrustItem[];
  onChange: (items: TrustItem[]) => void;
}) {
  const update = (index: number, patch: Partial<TrustItem>) =>
    onChange(items.map((item, i) => (i === index ? { ...item, ...patch } : item)));

  return (
    <>
      <span className="lab">{label}</span>
      {hint && <p className="hint">{hint}</p>}
      {items.map((item, i) => (
        <div className="row-block" key={i}>
          <TextField
            id={`trust-${i}-title`}
            label={`Promise ${i + 1} title`}
            value={item.title}
            onChange={(title) => update(i, { title })}
          />
          <TextField
            id={`trust-${i}-detail`}
            label={`Promise ${i + 1} detail`}
            value={item.detail}
            onChange={(detail) => update(i, { detail })}
          />
        </div>
      ))}
    </>
  );
}

/**
 * Patches, not whole arrays: a look's photo upload resolves long after it was
 * picked, and rebuilding the list from the `looks` this render closed over
 * would put back every other look as it stood at pick time. `onPatch` hands
 * the page an index and the changed keys, which it applies to current state.
 */
function LooksField({
  label,
  hint,
  looks,
  withFocus,
  onUploading,
  onPatch,
}: {
  label: string;
  hint?: string;
  looks: Look[];
  withFocus: boolean;
  onUploading: (uploading: boolean) => void;
  onPatch: (index: number, patch: Partial<Look>) => void;
}) {
  return (
    <>
      <span className="lab">{label}</span>
      {hint && <p className="hint">{hint}</p>}
      {looks.map((look, i) => (
        <fieldset className="fset look-block" key={i}>
          <legend className="fset-legend">
            {`Look ${i + 1}`}
            {CAPTIONED_LOOKS.has(i) && ' · shown with caption'}
          </legend>
          <ImageField
            label={`Look ${i + 1} photo`}
            value={look.imageUrl}
            focusX={withFocus ? look.focusX : undefined}
            focusY={withFocus ? look.focusY : undefined}
            onFocusChange={
              withFocus ? (focusX, focusY) => onPatch(i, { focusX, focusY }) : undefined
            }
            onUploading={onUploading}
            onChange={(imageUrl) => onPatch(i, { imageUrl })}
          />
          <TextField
            id={`look-${i}-no`}
            label={`Look ${i + 1} number`}
            value={look.lookNo}
            onChange={(lookNo) => onPatch(i, { lookNo })}
          />
          <TextField
            id={`look-${i}-title`}
            label={`Look ${i + 1} title`}
            value={look.title}
            onChange={(title) => onPatch(i, { title })}
          />
          <TextField
            id={`look-${i}-copy`}
            label={`Look ${i + 1} caption`}
            multiline
            value={look.copy}
            onChange={(copy) => onPatch(i, { copy })}
          />
          <TextField
            id={`look-${i}-href`}
            label={`Look ${i + 1} link`}
            maxLength={URL_MAX}
            value={look.ctaHref}
            onChange={(ctaHref) => onPatch(i, { ctaHref })}
          />
        </fieldset>
      ))}
    </>
  );
}

/** The archive's volumes — same patch discipline as LooksField, plus append
 *  (the archive grows; it never shrinks). Collections are edited as one
 *  comma-separated line — they must match products.collection values. */
function VolumesField({
  label,
  hint,
  volumes,
  withFocus,
  onUploading,
  onPatch,
  onAdd,
}: {
  label: string;
  hint?: string;
  volumes: Volume[];
  withFocus: boolean;
  onUploading: (uploading: boolean) => void;
  onPatch: (index: number, patch: Partial<Volume>) => void;
  onAdd: () => void;
}) {
  return (
    <>
      <span className="lab">{label}</span>
      {hint && <p className="hint">{hint}</p>}
      {volumes.map((vol, i) => (
        <fieldset className="fset look-block" key={i}>
          <legend className="fset-legend">{vol.volumeNo || `Volume ${i + 1}`}</legend>
          <ImageField
            label={`Volume ${i + 1} photo`}
            value={vol.imageUrl}
            focusX={withFocus ? vol.focusX : undefined}
            focusY={withFocus ? vol.focusY : undefined}
            onFocusChange={withFocus ? (focusX, focusY) => onPatch(i, { focusX, focusY }) : undefined}
            onUploading={onUploading}
            onChange={(imageUrl) => onPatch(i, { imageUrl })}
          />
          <TextField
            id={`vol-${i}-no`}
            label={`Volume ${i + 1} number`}
            value={vol.volumeNo}
            onChange={(volumeNo) => onPatch(i, { volumeNo })}
          />
          <TextField
            id={`vol-${i}-title`}
            label={`Volume ${i + 1} title`}
            value={vol.title}
            onChange={(title) => onPatch(i, { title })}
          />
          <TextField
            id={`vol-${i}-season`}
            label={`Volume ${i + 1} season`}
            value={vol.season}
            onChange={(season) => onPatch(i, { season })}
          />
          <TextField
            id={`vol-${i}-copy`}
            label={`Volume ${i + 1} copy`}
            multiline
            value={vol.copy}
            onChange={(copy) => onPatch(i, { copy })}
          />
          <TextField
            id={`vol-${i}-collections`}
            label={`Volume ${i + 1} sub-collections (comma-separated)`}
            value={vol.collections.join(', ')}
            onChange={(joined) => onPatch(i, { collections: joined.split(',').map((c) => c.trim()) })}
          />
          <TextField
            id={`vol-${i}-status`}
            label={`Volume ${i + 1} status`}
            value={vol.status}
            onChange={(status) => onPatch(i, { status })}
          />
        </fieldset>
      ))}
      {volumes.length < VOLUME_MAX && (
        <button type="button" className="btn-line" onClick={onAdd}>
          Add a volume
        </button>
      )}
    </>
  );
}

export default function SiteSectionEdit() {
  const { key } = useParams();
  const navigate = useNavigate();
  const toast = useToast();
  const config = SECTIONS.find((section) => section.key === key) ?? null;

  const [form, setForm] = useState<FormState | null>(null);
  const [customised, setCustomised] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Photo uploads still in flight, across every image field on the page. */
  const [uploads, setUploads] = useState(0);
  const [device, setDevice] = useState<PreviewDevice>('phone');
  const [previewOpen, setPreviewOpen] = useState(true);
  /** Stored lookbookCover row — the lookbook's preview renders beneath it. */
  const [coverStored, setCoverStored] = useState<Record<string, unknown> | null>(null);
  /** The form as loaded (or last saved/reset) — edits are measured against it. */
  const [baseline, setBaseline] = useState<string | null>(null);

  useEffect(() => {
    if (!config) return;
    let live = true;
    setForm(null);
    setBaseline(null);
    setError(null);
    api<{ sections: Record<string, unknown> }>('/api/content')
      .then((data) => {
        if (!live) return;
        const sections = isRecord(data.sections) ? data.sections : {};
        const stored = sections[config.key];
        const cover = sections.lookbookCover;
        const built = buildForm(config, isRecord(stored) ? stored : null);
        setCustomised(isRecord(stored));
        setCoverStored(isRecord(cover) ? cover : null);
        setForm(built);
        setBaseline(JSON.stringify(built));
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [config]);

  const isDirty = baseline !== null && form !== null && JSON.stringify(form) !== baseline;
  const guard = useUnsavedGuard(isDirty);

  // Unknown key (stale link, typo) — the list is the only sensible place to be.
  if (!config) return <Navigate to="/site" replace />;

  const setField = (name: string, value: unknown) =>
    setForm((f) => (f ? { ...f, [name]: value } : f));

  /**
   * One look, patched onto whatever the form holds *now*. A photo upload
   * resolves minutes after its pick on a phone; applying it to the array the
   * picker closed over would silently undo every edit made in between.
   */
  const patchLook = (name: string, index: number, patch: Partial<Look>) =>
    setForm((f) =>
      f
        ? {
            ...f,
            [name]: looksOf(f, name).map((look, i) =>
              i === index ? { ...look, ...patch } : look,
            ),
          }
        : f,
    );

  const patchVolume = (name: string, index: number, patch: Partial<Volume>) =>
    setForm((f) =>
      f
        ? {
            ...f,
            [name]: volumesOf(f, name).map((vol, i) => (i === index ? { ...vol, ...patch } : vol)),
          }
        : f,
    );

  /** New editions are appended — the archive never removes one (audit §06). */
  const addVolume = (name: string) =>
    setForm((f) => {
      if (!f) return f;
      const volumes = volumesOf(f, name);
      if (volumes.length >= VOLUME_MAX) return f;
      const next: Volume = {
        imageUrl: null, focusX: 50, focusY: 50,
        volumeNo: `Volume ${String(volumes.length + 1).padStart(2, '0')}`,
        title: '', season: '', copy: '', collections: [], status: '',
      };
      return { ...f, [name]: [...volumes, next] };
    });

  const onUploading = (uploading: boolean) =>
    setUploads((n) => Math.max(0, n + (uploading ? 1 : -1)));

  const onSave = async () => {
    if (!form) return;
    // Belt and braces — the Save button is disabled while a photo uploads, but
    // saving now would PUT the pre-upload URL and lose the photo.
    if (uploads > 0) {
      toast('Let the photo finish uploading first', { tone: 'error' });
      return;
    }
    const body = payload(config, form);
    // An empty list means "use the default" to the storefront, so saving one
    // would look successful and change nothing on the site.
    const emptied = config.fields.find(
      (field) => field.type === 'stringList' && (body[field.name] as string[]).length === 0,
    );
    if (emptied) {
      const noun = (LIST_NOUN[config.key] ?? 'Item').toLowerCase();
      toast(`${config.title} needs at least one ${noun}`, { tone: 'error' });
      return;
    }
    // Same budget, same wording as the API — but said here, because in prod the
    // WAF eats an over-long body at the edge and the readable 400 never lands.
    if (new Blob([JSON.stringify(body)]).size > MAX_SECTION_BYTES) {
      toast('Section too large — shorten the copy', { tone: 'error' });
      return;
    }
    setBusy(true);
    try {
      await api(`/api/admin/content/${config.key}`, { method: 'PUT', body });
      guard.release(); // saved — nothing left to guard
      toast('Live on the site');
      navigate('/site');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not save this section', { tone: 'error' });
      setBusy(false);
    }
  };

  const onReset = async () => {
    setBusy(true);
    try {
      await api(`/api/admin/content/${config.key}`, { method: 'DELETE' });
      const built = buildForm(config, null);
      setForm(built);
      setBaseline(JSON.stringify(built));
      setCustomised(false);
      setConfirming(false);
      toast('Back to the built-in default');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Could not reset this section', { tone: 'error' });
    }
    setBusy(false);
  };

  /** Both focal coordinates land in one state update — a tap sets a point. */
  const setFocus = (focusX: number, focusY: number) =>
    setForm((f) => (f ? { ...f, focusX, focusY } : f));

  const renderField = (field: FieldConfig, state: FormState) => {
    switch (field.type) {
      case 'image':
        return (
          <ImageField
            key={field.name}
            label={field.label}
            hint={field.hint}
            value={imgOf(state, field.name)}
            focusX={field.focus ? pctOf(state, 'focusX') : undefined}
            focusY={field.focus ? pctOf(state, 'focusY') : undefined}
            onFocusChange={field.focus ? setFocus : undefined}
            onUploading={onUploading}
            onChange={(value) => setField(field.name, value)}
          />
        );
      case 'stringList':
        return (
          <ListField
            key={field.name}
            label={field.label}
            hint={field.hint}
            noun={LIST_NOUN[config.key] ?? 'Item'}
            max={LIST_MAX[config.key] ?? 8}
            items={listOf(state, field.name)}
            onChange={(items) => setField(field.name, items)}
          />
        );
      case 'trustItems':
        return (
          <TrustField
            key={field.name}
            label={field.label}
            hint={field.hint}
            items={trustOf(state, field.name)}
            onChange={(items) => setField(field.name, items)}
          />
        );
      case 'looks':
        return (
          <LooksField
            key={field.name}
            label={field.label}
            hint={field.hint}
            looks={looksOf(state, field.name)}
            withFocus={Boolean(field.focus)}
            onUploading={onUploading}
            onPatch={(index, patch) => patchLook(field.name, index, patch)}
          />
        );
      case 'volumes':
        return (
          <VolumesField
            key={field.name}
            label={field.label}
            hint={field.hint}
            volumes={volumesOf(state, field.name)}
            withFocus={Boolean(field.focus)}
            onUploading={onUploading}
            onPatch={(index, patch) => patchVolume(field.name, index, patch)}
            onAdd={() => addVolume(field.name)}
          />
        );
      default:
        return (
          <TextField
            key={field.name}
            id={`sc-${field.name}`}
            label={field.label}
            hint={field.hint}
            multiline={field.type === 'textarea'}
            maxLength={maxLengthFor(field.name)}
            value={strOf(state, field.name)}
            onChange={(value) => setField(field.name, value)}
          />
        );
    }
  };

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">Site · {config.blurb}</span>
        <h1>{config.title}</h1>
        {/* The storefront reads a blank field as "no override", so clearing one
            saves cleanly and still shows the built-in copy. Said once, here,
            rather than under all twenty-odd fields. */}
        <p className="sub">Leaving a field blank restores the built-in copy.</p>
      </div>

      {error && <p className="state-note">{error}</p>}
      {!form && !error && <p className="state-note">Loading section…</p>}

      {form && (
        <div className="sec-layout">
          {/* The section as the storefront will render it, re-merged from the
              form on every keystroke. Sticky: above the form on a phone,
              beside it on a desktop. */}
          <div className="editor-preview">
            <div className="editor-preview-head">
              <DeviceToggle device={device} onChange={setDevice} />
              {uploads > 0 && <span className="uploading-chip">Photo uploading…</span>}
              <button
                type="button"
                className="ulink preview-collapse"
                aria-expanded={previewOpen}
                onClick={() => setPreviewOpen((open) => !open)}
              >
                {previewOpen ? 'Hide preview' : 'Show preview'}
              </button>
            </div>
            {previewOpen && (
              <div className="editor-preview-frame">
                <SectionLivePreview
                  sectionKey={config.key}
                  body={payload(config, form)}
                  coverStored={coverStored}
                  device={device}
                />
              </div>
            )}
          </div>

          <form
            className="sec-editor"
            noValidate
            onSubmit={(e) => {
              e.preventDefault();
              void onSave();
            }}
          >
            {config.fields.map((field) => renderField(field, form))}

            {customised && (
              <div className="sec-reset">
                {confirming ? (
                  <>
                    <p className="hint">
                      This puts back the boutique&rsquo;s built-in copy for {config.title}.
                    </p>
                    <div className="sec-reset-actions">
                      <button
                        type="button"
                        className="btn-outline fit danger"
                        disabled={busy}
                        onClick={() => void onReset()}
                      >
                        Yes, reset
                      </button>
                      <button
                        type="button"
                        className="btn-outline fit"
                        disabled={busy}
                        onClick={() => setConfirming(false)}
                      >
                        Keep
                      </button>
                    </div>
                  </>
                ) : (
                  <button
                    type="button"
                    className="btn-outline fit danger"
                    onClick={() => setConfirming(true)}
                  >
                    Reset to default
                  </button>
                )}
              </div>
            )}

            <div className="savebar">
              <button
                type="button"
                className="btn-outline fit"
                disabled={busy}
                onClick={() => navigate('/site')}
              >
                Cancel
              </button>
              <button className="btn-buy gold" type="submit" disabled={busy || uploads > 0}>
                {uploads > 0 ? 'Uploading photo…' : busy ? 'Saving…' : 'Save'}
              </button>
            </div>

            {guard.blocked && (
              <ConfirmModal
                title="Discard unsaved changes?"
                confirmLabel="Discard"
                cancelLabel="Keep editing"
                tone="danger"
                onConfirm={guard.confirmLeave}
                onCancel={guard.stay}
              >
                <p>This section has edits that have not been saved.</p>
              </ConfirmModal>
            )}
          </form>
        </div>
      )}
    </>
  );
}
