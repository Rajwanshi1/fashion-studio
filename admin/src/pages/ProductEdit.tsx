import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { uploadProductImage } from '../lib/uploads';
import { useUnsavedGuard } from '../lib/useUnsavedGuard';
import type { AdminProduct, Category, ProductImage, Variant } from '../lib/types';
import ConfirmModal from '../components/ConfirmModal';
import { useToast } from '../components/Toast';

const NEW_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'Custom'];

const OCCASION_SUGGESTIONS = ['Wedding', 'Reception', 'Festive', 'Cocktail'];

/** One glyph per seeded category; anything new falls back to the gown. */
const CATEGORY_ICONS: Record<string, string> = {
  kaftan: '🧥',
  anarkali: '👗',
  suits: '🥻',
  lehenga: '💃',
  antifit: '🌿',
};

const FABRICS = ['Silk', 'Cotton'];

/** Matches the server's images cap (productBaseSchema .max(12)). */
const MAX_IMAGES = 12;

interface FormState {
  name: string;
  categorySlug: string;
  description: string;
  details: string;
  priceRupees: string;
  color: string;
  flag: '' | 'bestseller' | 'new' | 'sale';
  /** Linked pair — the sale price is authoritative, the percentage is derived. */
  saleRupees: string;
  discountPct: string;
  /** Admin-only; never leaves the admin API. */
  costRupees: string;
  images: ProductImage[];
  active: boolean;
  collection: string;
  craft: string;
  fabric: string;
  occasion: string;
  /** Rupees as typed; empty = the set has no dupatta/jacket, '0' = included free. */
  dupattaRupees: string;
  jacketRupees: string;
}

const FLAG_OPTIONS: [FormState['flag'], string, string][] = [
  ['', 'None', '—'],
  ['bestseller', 'Bestseller', '★'],
  ['new', 'New', '✦'],
  ['sale', 'Sale', '%'],
];

const EMPTY_FORM: FormState = {
  name: '',
  categorySlug: '',
  description: '',
  details: '',
  priceRupees: '',
  color: '',
  flag: '',
  saleRupees: '',
  discountPct: '',
  costRupees: '',
  images: [],
  // New pieces start hidden — a name-and-price-only piece must never appear
  // live on the boutique as a blank product page.
  active: false,
  collection: '',
  craft: '',
  fabric: '',
  occasion: '',
  dupattaRupees: '',
  jacketRupees: '',
};

const SALE_ERROR = 'Sale price must be below the regular price';

/** Percentage → rupees. A blank or unreadable partner leaves the field empty. */
function saleFromPct(priceRupees: string, pct: string): string {
  const price = Number(priceRupees);
  const p = Number(pct);
  if (priceRupees.trim() === '' || pct.trim() === '') return '';
  if (!Number.isFinite(price) || !Number.isFinite(p)) return '';
  return String(Math.round(price * (1 - p / 100)));
}

/** Rupees → percentage, the derived half of the pair. */
function pctFromSale(priceRupees: string, saleRupees: string): string {
  const price = Number(priceRupees);
  const sale = Number(saleRupees);
  if (saleRupees.trim() === '' || !Number.isFinite(price) || price <= 0) return '';
  if (!Number.isFinite(sale)) return '';
  return String(Math.round((1 - sale / price) * 100));
}

/** Paise → rupees string for the form; null stays blank. */
function rupees(paise: number | null): string {
  return paise == null ? '' : String(paise / 100);
}

export default function ProductEdit() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();

  const [categories, setCategories] = useState<Category[]>([]);
  const [catalogue, setCatalogue] = useState<AdminProduct[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [stocks, setStocks] = useState<Record<string, string>>({});
  const [baseline, setBaseline] = useState<string | null>(null);
  const [loading, setLoading] = useState(!isNew);
  const [notFound, setNotFound] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);
  const errRef = useRef<HTMLDivElement>(null);

  // The form is long and the submit button sits at the bottom — an error that
  // renders quietly at the top is indistinguishable from a dead button.
  useEffect(() => {
    if (!error) return;
    errRef.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
    errRef.current?.focus();
  }, [error]);

  useEffect(() => {
    let live = true;
    api<Category[]>('/api/categories')
      .then((data) => live && setCategories(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  useEffect(() => {
    if (isNew) {
      const initialStocks = Object.fromEntries(NEW_SIZES.map((s) => [s, '0']));
      setForm(EMPTY_FORM);
      setVariants([]);
      setStocks(initialStocks);
      setBaseline(JSON.stringify({ form: EMPTY_FORM, stocks: initialStocks }));
      setLoading(false);
    } else {
      setLoading(true);
    }
    let live = true;
    // The whole catalogue in one call: the edit target when editing, and the
    // existing colour/collection/craft values feeding the field suggestions.
    api<AdminProduct[]>('/api/admin/products')
      .then((products) => {
        if (!live) return;
        setCatalogue(products);
        if (isNew) return;
        const product = products.find((p) => p.id === id);
        if (!product) {
          setNotFound(true);
          setLoading(false);
          return;
        }
        // Pieces saved before galleries existed carry a lone imageUrl — show it
        // as the first (only) gallery photo so they stay editable.
        const gallery: ProductImage[] =
          product.images && product.images.length > 0
            ? product.images.map((img) => ({ url: img.url, pose: img.pose ?? '' }))
            : product.imageUrl
              ? [{ url: product.imageUrl, pose: '' }]
              : [];
        const priceRupees = String(product.price / 100);
        const saleRupees = rupees(product.salePrice);
        const nextForm: FormState = {
          name: product.name,
          categorySlug: product.categorySlug,
          description: product.description,
          details: product.details,
          priceRupees,
          color: product.color,
          flag: product.flag ?? '',
          saleRupees,
          discountPct: product.flag === 'sale' ? pctFromSale(priceRupees, saleRupees) : '',
          costRupees: rupees(product.costPrice),
          images: gallery,
          active: product.active,
          collection: product.collection,
          craft: product.craft,
          fabric: product.fabric,
          occasion: product.occasion,
          dupattaRupees: rupees(product.dupattaPrice),
          jacketRupees: rupees(product.jacketPrice),
        };
        const nextStocks = Object.fromEntries(product.variants.map((v) => [v.id, String(v.stock)]));
        setForm(nextForm);
        setVariants(product.variants);
        setStocks(nextStocks);
        setBaseline(JSON.stringify({ form: nextForm, stocks: nextStocks }));
        setLoading(false);
      })
      .catch((err: Error) => {
        if (!live) return;
        // A failed suggestions fetch must not block a blank New Piece form.
        if (!isNew) {
          setError(err.message);
          setLoading(false);
        }
      });
    return () => {
      live = false;
    };
  }, [id, isNew]);

  const isDirty = baseline !== null && JSON.stringify({ form, stocks }) !== baseline;
  const guard = useUnsavedGuard(isDirty);

  /** Existing values across the catalogue — free text with suggestions keeps
   *  one typo from fragmenting the storefront's filters (TA-020). */
  const suggestions = (key: 'color' | 'collection' | 'craft' | 'occasion'): string[] =>
    [...new Set(catalogue.map((p) => p[key]).filter(Boolean))].sort();

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  /** The sale price is authoritative: editing the base price re-derives the %. */
  const onPriceChange = (priceRupees: string) =>
    setForm((f) => ({
      ...f,
      priceRupees,
      discountPct: f.flag === 'sale' ? pctFromSale(priceRupees, f.saleRupees) : f.discountPct,
    }));

  const onDiscountChange = (discountPct: string) =>
    setForm((f) => ({ ...f, discountPct, saleRupees: saleFromPct(f.priceRupees, discountPct) }));

  const onSaleChange = (saleRupees: string) =>
    setForm((f) => ({ ...f, saleRupees, discountPct: pctFromSale(f.priceRupees, saleRupees) }));

  /** Clicking the live chip clears the choice; a legacy fabric is display-only. */
  const onFabricChip = (fabric: string) =>
    setForm((f) => ({ ...f, fabric: f.fabric === fabric ? '' : fabric }));

  const moveImage = (index: number, delta: -1 | 1) =>
    setForm((f) => {
      const to = index + delta;
      if (to < 0 || to >= f.images.length) return f;
      const images = [...f.images];
      [images[index], images[to]] = [images[to], images[index]];
      return { ...f, images };
    });

  const removeImage = (index: number) =>
    setForm((f) => ({ ...f, images: f.images.filter((_, i) => i !== index) }));

  const addImageUrl = () => {
    const url = urlDraft.trim();
    if (!url) return;
    setForm((f) => ({ ...f, images: [...f.images, { url, pose: '' }] }));
    setUrlDraft('');
  };

  /** '' → null (not in the set); otherwise rupees → paise. NaN/negative → undefined (invalid). */
  const addonPaise = (rupeesText: string): number | null | undefined => {
    if (rupeesText.trim() === '') return null;
    const paise = Math.round(Number(rupeesText) * 100);
    return Number.isFinite(paise) && paise >= 0 ? paise : undefined;
  };

  /** Uploads run one at a time — the vision naming call is per photo. */
  const onPhotosPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    let files = Array.from(e.target.files ?? []);
    e.target.value = ''; // allow re-selecting the same file (retake)
    if (files.length === 0) return;
    const room = MAX_IMAGES - form.images.length;
    if (room <= 0) {
      toast(`A piece can have at most ${MAX_IMAGES} photos`, { tone: 'error' });
      return;
    }
    if (files.length > room) {
      toast(`A piece can have at most ${MAX_IMAGES} photos — uploading the first ${room}`, { tone: 'error' });
      files = files.slice(0, room);
    }
    setUploading({ done: 0, total: files.length });
    let added = 0;
    for (const file of files) {
      try {
        const { publicUrl, pose } = await uploadProductImage(file, form.name);
        setForm((f) => ({ ...f, images: [...f.images, { url: publicUrl, pose: pose ?? '' }] }));
        added += 1;
      } catch (err) {
        toast(err instanceof Error ? err.message : 'Photo upload failed', { tone: 'error' });
      }
      setUploading((u) => (u ? { ...u, done: u.done + 1 } : u));
    }
    setUploading(null);
    if (added > 0) toast(added === 1 ? 'Photo uploaded' : `${added} photos uploaded`);
  };

  const pricePaise = Math.round(Number(form.priceRupees) * 100);
  const salePaise = form.saleRupees.trim() === '' ? NaN : Math.round(Number(form.saleRupees) * 100);
  const saleError =
    form.flag === 'sale' && !(Number.isFinite(salePaise) && salePaise > 0 && salePaise < pricePaise)
      ? SALE_ERROR
      : null;

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    // Collect every problem at once — one-error-at-a-time costs a full
    // scroll-and-resubmit round trip per field (TA-022).
    const problems: string[] = [];
    if (!form.name.trim()) problems.push('Name is required');
    if (!form.categorySlug) problems.push('Choose a category');
    if (!Number.isFinite(pricePaise) || pricePaise < 0 || form.priceRupees.trim() === '') {
      problems.push('Enter a valid price in rupees');
    }
    if (saleError) problems.push(saleError);
    const dupattaPrice = addonPaise(form.dupattaRupees);
    const jacketPrice = addonPaise(form.jacketRupees);
    if (dupattaPrice === undefined || jacketPrice === undefined) {
      problems.push('Set-includes prices must be 0 or more — leave blank when the set has no such piece');
    }
    const costPrice = addonPaise(form.costRupees);
    if (costPrice === undefined) {
      problems.push('Cost price must be 0 or more — leave it blank if you do not track it');
    }
    if (problems.length > 0) {
      setError(problems.join('\n'));
      return;
    }

    const body = {
      name: form.name.trim(),
      categorySlug: form.categorySlug,
      description: form.description,
      details: form.details,
      price: pricePaise,
      color: form.color,
      flag: form.flag === '' ? null : form.flag,
      salePrice: form.flag === 'sale' ? salePaise : null,
      costPrice,
      images: form.images.map(({ url, pose }) => ({ url, pose })),
      active: form.active,
      collection: form.collection.trim(),
      craft: form.craft.trim(),
      fabric: form.fabric.trim(),
      occasion: form.occasion.trim(),
      dupattaPrice,
      jacketPrice,
    };

    setBusy(true);
    try {
      if (isNew) {
        await api('/api/admin/products', {
          method: 'POST',
          body: {
            ...body,
            variants: NEW_SIZES.map((size) => ({
              size,
              stock: Math.max(0, Math.round(Number(stocks[size]) || 0)),
            })),
          },
        });
      } else {
        await api(`/api/admin/products/${id}`, { method: 'PUT', body });
        const changed = variants.filter(
          (v) => Math.round(Number(stocks[v.id]) || 0) !== v.stock,
        );
        for (const v of changed) {
          await api(`/api/admin/variants/${v.id}`, {
            method: 'PATCH',
            body: { stock: Math.max(0, Math.round(Number(stocks[v.id]) || 0)) },
          });
        }
      }
      guard.release(); // saved — nothing left to guard
      toast(isNew ? 'Piece added to the collection' : 'Piece saved');
      navigate('/products');
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Unable to save';
      setError(message);
      toast(message, { tone: 'error' });
      setBusy(false);
    }
  };

  if (loading) return <p className="state-note">Loading piece…</p>;

  // A bad or stale link must not render a live, saveable empty form —
  // filling it in would write into nothing.
  if (notFound) {
    return (
      <>
        <div className="page-head-admin">
          <span className="eyebrow">Inventory</span>
          <h1>Piece not found</h1>
        </div>
        <p className="state-note">
          No piece exists at this address — it may have been deleted, or the link is stale.
        </p>
        <p className="state-note">
          <Link className="ulink" to="/products">
            ← Back to Products
          </Link>
        </p>
      </>
    );
  }

  const stockKeys: { key: string; label: string }[] = isNew
    ? NEW_SIZES.map((s) => ({ key: s, label: s }))
    : variants.map((v) => ({ key: v.id, label: v.size }));

  const legacyFabric = form.fabric !== '' && !FABRICS.includes(form.fabric) ? form.fabric : null;
  const lastImage = form.images.length - 1;

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">Inventory</span>
        <h1>{isNew ? 'New Piece' : 'Edit Piece'}</h1>
      </div>

      <form className="form-card" onSubmit={onSubmit} noValidate>
        <div className="grid2">
          <div className="field">
            <label className="lab" htmlFor="p-name">
              Name
            </label>
            <input
              id="p-name"
              className="inp"
              value={form.name}
              onChange={(e) => set('name', e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label className="lab" htmlFor="p-price">
              Price (₹ rupees)
            </label>
            <input
              id="p-price"
              className="inp"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={form.priceRupees}
              onChange={(e) => onPriceChange(e.target.value)}
              required
            />
          </div>
        </div>

        <div className="field">
          <span className="lab">Category</span>
          <div className="chips" role="group" aria-label="Category">
            {categories.map((c) => (
              <button
                key={c.id}
                type="button"
                className={form.categorySlug === c.slug ? 'chip on' : 'chip'}
                aria-pressed={form.categorySlug === c.slug}
                onClick={() => set('categorySlug', c.slug)}
              >
                {(CATEGORY_ICONS[c.slug] ?? '👗') + ' ' + c.name}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label className="lab" htmlFor="p-description">
            Description
          </label>
          <textarea
            id="p-description"
            className="inp"
            value={form.description}
            onChange={(e) => set('description', e.target.value)}
          />
        </div>

        <div className="field">
          <label className="lab" htmlFor="p-details">
            Details
          </label>
          <textarea
            id="p-details"
            className="inp"
            value={form.details}
            onChange={(e) => set('details', e.target.value)}
          />
        </div>

        <div className="grid2">
          <div className="field">
            <label className="lab" htmlFor="p-color">
              Color
            </label>
            <input
              id="p-color"
              className="inp"
              list="color-suggestions"
              value={form.color}
              onChange={(e) => set('color', e.target.value)}
            />
            <datalist id="color-suggestions">
              {suggestions('color').map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label className="lab" htmlFor="p-collection">
              Collection
            </label>
            <input
              id="p-collection"
              className="inp"
              list="collection-suggestions"
              placeholder="e.g. The Verdant Edit"
              value={form.collection}
              onChange={(e) => set('collection', e.target.value)}
            />
            <datalist id="collection-suggestions">
              {suggestions('collection').map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label className="lab" htmlFor="p-craft">
              Craft / Work
            </label>
            <input
              id="p-craft"
              className="inp"
              list="craft-suggestions"
              placeholder="e.g. Zardozi"
              value={form.craft}
              onChange={(e) => set('craft', e.target.value)}
            />
            <datalist id="craft-suggestions">
              {suggestions('craft').map((v) => (
                <option key={v} value={v} />
              ))}
            </datalist>
          </div>
          <div className="field">
            <label className="lab" htmlFor="p-occasion">
              Occasion
            </label>
            <input
              id="p-occasion"
              className="inp"
              list="occasion-suggestions"
              placeholder="e.g. Wedding"
              value={form.occasion}
              onChange={(e) => set('occasion', e.target.value)}
            />
            <datalist id="occasion-suggestions">
              {[...new Set([...OCCASION_SUGGESTIONS, ...suggestions('occasion')])].map((o) => (
                <option key={o} value={o} />
              ))}
            </datalist>
          </div>
        </div>

        <div className="field">
          <span className="lab">Fabric</span>
          <div className="chips" role="group" aria-label="Fabric">
            {FABRICS.map((f) => (
              <button
                key={f}
                type="button"
                className={form.fabric === f ? 'chip on' : 'chip'}
                aria-pressed={form.fabric === f}
                onClick={() => onFabricChip(f)}
              >
                {f}
              </button>
            ))}
            {/* A fabric typed before this became a chip row — shown, not reselectable. */}
            {legacyFabric && (
              <button type="button" className="chip on" aria-pressed="true">
                {legacyFabric}
              </button>
            )}
          </div>
        </div>

        <div className="field">
          <span className="lab">Flag</span>
          <div className="chips" role="group" aria-label="Flag">
            {FLAG_OPTIONS.map(([value, label, icon]) => (
              <button
                key={value}
                type="button"
                className={form.flag === value ? 'chip on' : 'chip'}
                aria-pressed={form.flag === value}
                onClick={() => set('flag', value)}
              >
                {icon + ' ' + label}
              </button>
            ))}
          </div>
        </div>

        {form.flag === 'sale' && (
          <>
            <div className="grid2">
              <div className="field">
                <label className="lab" htmlFor="p-discount">
                  Discount (%)
                </label>
                <input
                  id="p-discount"
                  className="inp"
                  type="number"
                  min="0"
                  max="99"
                  step="1"
                  inputMode="numeric"
                  value={form.discountPct}
                  onChange={(e) => onDiscountChange(e.target.value)}
                />
              </div>
              <div className="field">
                <label className="lab" htmlFor="p-sale">
                  Sale price (₹ rupees)
                </label>
                <input
                  id="p-sale"
                  className="inp"
                  type="number"
                  min="0"
                  step="1"
                  inputMode="numeric"
                  value={form.saleRupees}
                  onChange={(e) => onSaleChange(e.target.value)}
                />
              </div>
            </div>
            {saleError && (
              <div className="form-err" role="alert">
                {saleError}
              </div>
            )}
            <p className="hint">Dupatta and jacket add-ons are never discounted.</p>
          </>
        )}

        <p className="section-label">Set includes</p>
        <div className="grid2">
          <div className="field">
            <label className="lab" htmlFor="p-dupatta">
              Dupatta price (₹ — blank if no dupatta, 0 if included free)
            </label>
            <input
              id="p-dupatta"
              className="inp"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={form.dupattaRupees}
              onChange={(e) => set('dupattaRupees', e.target.value)}
            />
          </div>
          <div className="field">
            <label className="lab" htmlFor="p-jacket">
              Jacket price (₹ — blank if no jacket, 0 if included free)
            </label>
            <input
              id="p-jacket"
              className="inp"
              type="number"
              min="0"
              step="1"
              inputMode="numeric"
              value={form.jacketRupees}
              onChange={(e) => set('jacketRupees', e.target.value)}
            />
          </div>
        </div>

        <p className="section-label">Internal</p>
        <div className="field">
          <label className="lab" htmlFor="p-cost">
            Cost price (₹ — admin only, never shown in the boutique)
          </label>
          <input
            id="p-cost"
            className="inp"
            type="number"
            min="0"
            step="1"
            inputMode="numeric"
            value={form.costRupees}
            onChange={(e) => set('costRupees', e.target.value)}
          />
        </div>

        <p className="section-label">Photos</p>
        <div className="field">
          <input
            ref={photoInput}
            type="file"
            accept="image/*,.heic,.heif"
            multiple
            hidden
            aria-label="Product photo file"
            onChange={(e) => void onPhotosPicked(e)}
          />
          <div className="photo-row">
            <button
              type="button"
              className="btn-outline fit"
              disabled={uploading !== null}
              onClick={() => photoInput.current?.click()}
            >
              {uploading
                ? `Uploading ${Math.min(uploading.done + 1, uploading.total)} of ${uploading.total}…`
                : 'Add photos'}
            </button>
          </div>
          {form.images.length > 0 && (
            <div className="thumb-strip">
              {form.images.map((img, i) => (
                <figure className="thumb" key={`${img.url}#${i}`}>
                  <img
                    src={img.url}
                    alt={img.pose ? `Product photo ${i + 1} — ${img.pose}` : `Product photo ${i + 1}`}
                  />
                  {/* The AI naming call guesses the pose; guesses must be correctable. */}
                  <select
                    className="inp thumb-pose"
                    aria-label={`Pose tag for photo ${i + 1}`}
                    value={img.pose}
                    onChange={(e) =>
                      setForm((f) => ({
                        ...f,
                        images: f.images.map((im, x) =>
                          x === i ? { ...im, pose: e.target.value } : im,
                        ),
                      }))
                    }
                  >
                    <option value="">No tag</option>
                    {['front', 'back', 'side', 'detail'].map((p) => (
                      <option key={p} value={p}>
                        {p.charAt(0).toUpperCase() + p.slice(1)}
                      </option>
                    ))}
                    {img.pose && !['front', 'back', 'side', 'detail'].includes(img.pose) && (
                      <option value={img.pose}>{img.pose}</option>
                    )}
                  </select>
                  <div className="thumb-actions">
                    <button
                      type="button"
                      className="ulink"
                      aria-label={`Move image ${i + 1} up`}
                      disabled={i === 0}
                      onClick={() => moveImage(i, -1)}
                    >
                      ↑
                    </button>
                    <button
                      type="button"
                      className="ulink"
                      aria-label={`Move image ${i + 1} down`}
                      disabled={i === lastImage}
                      onClick={() => moveImage(i, 1)}
                    >
                      ↓
                    </button>
                    <button
                      type="button"
                      className="ulink"
                      aria-label={`Remove image ${i + 1}`}
                      onClick={() => removeImage(i)}
                    >
                      ✕
                    </button>
                  </div>
                </figure>
              ))}
            </div>
          )}
        </div>
        <div className="field">
          <label className="lab" htmlFor="p-image">
            Image URL (or paste one directly)
          </label>
          <div className="photo-row">
            <input
              id="p-image"
              className="inp"
              type="url"
              placeholder="https://…"
              value={urlDraft}
              onChange={(e) => setUrlDraft(e.target.value)}
            />
            <button
              type="button"
              className="btn-outline fit"
              disabled={urlDraft.trim() === ''}
              onClick={addImageUrl}
            >
              Add photo URL
            </button>
          </div>
        </div>

        <div className="field">
          <label className="check">
            <input
              type="checkbox"
              checked={form.active}
              onChange={(e) => set('active', e.target.checked)}
            />
            Active — visible in the boutique
          </label>
          {!form.active &&
            (() => {
              const missing = [
                form.images.length === 0 && 'add a photo',
                !form.description.trim() && 'write a description',
                Object.values(stocks).every((s) => Math.round(Number(s) || 0) === 0) &&
                  'stock at least one size',
              ].filter(Boolean);
              return (
                <p className="x">
                  Hidden from the boutique.{' '}
                  {missing.length > 0
                    ? `Before going live: ${missing.join(', ')}.`
                    : 'Tick the box when it should go live.'}
                </p>
              );
            })()}
        </div>

        <p className="section-label">Stock by size</p>
        <div className="variants-grid">
          {stockKeys.map(({ key, label }) => (
            <div className="field" key={key}>
              <label className="lab" htmlFor={`stock-${key}`}>
                {label}
              </label>
              <input
                id={`stock-${key}`}
                className="inp"
                type="number"
                min="0"
                step="1"
                inputMode="numeric"
                value={stocks[key] ?? '0'}
                onChange={(e) => setStocks((s) => ({ ...s, [key]: e.target.value }))}
              />
            </div>
          ))}
        </div>

        {error && (
          <div className="form-err" role="alert" ref={errRef} tabIndex={-1}>
            {error.split('\n').map((line, i) => (
              <p key={i}>{line}</p>
            ))}
          </div>
        )}

        <div className="form-actions">
          <button className="btn-buy gold fit" type="submit" disabled={busy}>
            {busy ? 'Saving…' : isNew ? 'Add Piece' : 'Save Piece'}
          </button>
          <button
            className="btn-outline fit"
            type="button"
            onClick={() => navigate('/products')}
          >
            Cancel
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
            <p>This piece has edits that have not been saved.</p>
          </ConfirmModal>
        )}
      </form>
    </>
  );
}
