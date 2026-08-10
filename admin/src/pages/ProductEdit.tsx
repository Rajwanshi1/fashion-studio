import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { moveItem } from '../lib/reorder';
import { uploadProductImage } from '../lib/uploads';
import type { AdminProduct, Category, ProductImage, Variant } from '../lib/types';
import { ThumbStrip } from '../components/ThumbStrip';
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
  active: true,
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
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [stocks, setStocks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState<{ done: number; total: number } | null>(null);
  const [urlDraft, setUrlDraft] = useState('');
  const photoInput = useRef<HTMLInputElement>(null);

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
      setForm(EMPTY_FORM);
      setVariants([]);
      setStocks(Object.fromEntries(NEW_SIZES.map((s) => [s, '0'])));
      setLoading(false);
      return;
    }
    let live = true;
    setLoading(true);
    api<AdminProduct[]>('/api/admin/products')
      .then((products) => {
        if (!live) return;
        const product = products.find((p) => p.id === id);
        if (!product) {
          setError('Piece not found');
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
        setForm({
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
        });
        setVariants(product.variants);
        setStocks(Object.fromEntries(product.variants.map((v) => [v.id, String(v.stock)])));
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
  }, [id, isNew]);

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

  const reorderImage = (from: number, to: number) =>
    setForm((f) => ({ ...f, images: moveItem(f.images, from, to) }));

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
    if (!form.name.trim()) {
      setError('Name is required');
      return;
    }
    if (!form.categorySlug) {
      setError('Please choose a category');
      return;
    }
    if (!Number.isFinite(pricePaise) || pricePaise < 0 || form.priceRupees.trim() === '') {
      setError('Please enter a valid price in rupees');
      return;
    }
    if (saleError) return; // shown inline under the sale fields
    const dupattaPrice = addonPaise(form.dupattaRupees);
    const jacketPrice = addonPaise(form.jacketRupees);
    if (dupattaPrice === undefined || jacketPrice === undefined) {
      setError('Set-includes prices must be 0 or more — leave blank when the set has no such piece');
      return;
    }
    const costPrice = addonPaise(form.costRupees);
    if (costPrice === undefined) {
      setError('Cost price must be 0 or more — leave it blank if you do not track it');
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
      toast(isNew ? 'Piece added to the collection' : 'Piece saved');
      navigate('/products');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to save');
      setBusy(false);
    }
  };

  if (loading) return <p className="state-note">Loading piece…</p>;

  const stockKeys: { key: string; label: string }[] = isNew
    ? NEW_SIZES.map((s) => ({ key: s, label: s }))
    : variants.map((v) => ({ key: v.id, label: v.size }));

  const legacyFabric = form.fabric !== '' && !FABRICS.includes(form.fabric) ? form.fabric : null;

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">Inventory</span>
        <h1>{isNew ? 'New Piece' : 'Edit Piece'}</h1>
      </div>

      <form className="form-card" onSubmit={onSubmit} noValidate>
        {error && (
          <div className="form-err" role="alert">
            {error}
          </div>
        )}

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
              value={form.color}
              onChange={(e) => set('color', e.target.value)}
            />
          </div>
          <div className="field">
            <label className="lab" htmlFor="p-collection">
              Collection
            </label>
            <input
              id="p-collection"
              className="inp"
              placeholder="e.g. The Verdant Edit"
              value={form.collection}
              onChange={(e) => set('collection', e.target.value)}
            />
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
              placeholder="e.g. Zardozi"
              value={form.craft}
              onChange={(e) => set('craft', e.target.value)}
            />
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
              {OCCASION_SUGGESTIONS.map((o) => (
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
                : form.images.length > 0
                  ? 'Add photos'
                  : 'Upload photos'}
            </button>
          </div>
          <ThumbStrip images={form.images} onReorder={reorderImage} onRemove={removeImage} />
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
      </form>
    </>
  );
}
