import { useEffect, useRef, useState } from 'react';
import type { ChangeEvent, FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { uploadProductImage } from '../lib/uploads';
import type { AdminProduct, Category, Variant } from '../lib/types';
import { useToast } from '../components/Toast';

const NEW_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'Custom'];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

/** The slug auto-derives from name + colour until the admin edits it by hand. */
function deriveSlug(name: string, color: string): string {
  return slugify(`${name} ${color}`);
}

const OCCASION_SUGGESTIONS = ['Wedding', 'Reception', 'Festive', 'Cocktail'];

interface FormState {
  name: string;
  slug: string;
  categoryId: string;
  description: string;
  details: string;
  priceRupees: string;
  color: string;
  flag: '' | 'bestseller' | 'new';
  imageUrl: string;
  active: boolean;
  collection: string;
  craft: string;
  fabric: string;
  occasion: string;
  /** Rupees as typed; empty = the set has no dupatta/jacket, '0' = included free. */
  dupattaRupees: string;
  jacketRupees: string;
}

const EMPTY_FORM: FormState = {
  name: '',
  slug: '',
  categoryId: '',
  description: '',
  details: '',
  priceRupees: '',
  color: '',
  flag: '',
  imageUrl: '',
  active: true,
  collection: '',
  craft: '',
  fabric: '',
  occasion: '',
  dupattaRupees: '',
  jacketRupees: '',
};

export default function ProductEdit() {
  const { id } = useParams();
  const isNew = !id;
  const navigate = useNavigate();
  const toast = useToast();

  const [categories, setCategories] = useState<Category[]>([]);
  const [form, setForm] = useState<FormState>(EMPTY_FORM);
  const [slugTouched, setSlugTouched] = useState(false);
  const [variants, setVariants] = useState<Variant[]>([]);
  const [stocks, setStocks] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(!isNew);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [pendingCategorySlug, setPendingCategorySlug] = useState<string | null>(null);
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
      setSlugTouched(false);
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
        setForm({
          name: product.name,
          slug: product.slug,
          categoryId: '', // resolved from categorySlug once categories load
          description: product.description,
          details: product.details,
          priceRupees: String(product.price / 100),
          color: product.color,
          flag: product.flag ?? '',
          imageUrl: product.imageUrl ?? '',
          active: product.active,
          collection: product.collection,
          craft: product.craft,
          fabric: product.fabric,
          occasion: product.occasion,
          dupattaRupees: product.dupattaPrice == null ? '' : String(product.dupattaPrice / 100),
          jacketRupees: product.jacketPrice == null ? '' : String(product.jacketPrice / 100),
        });
        // Keep auto-deriving only while the stored slug still matches the
        // derivation — a hand-authored slug must survive name/colour edits.
        setSlugTouched(product.slug !== deriveSlug(product.name, product.color));
        setVariants(product.variants);
        setStocks(Object.fromEntries(product.variants.map((v) => [v.id, String(v.stock)])));
        // remember slug for category resolution
        setPendingCategorySlug(product.categorySlug);
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

  useEffect(() => {
    if (!pendingCategorySlug || categories.length === 0) return;
    const match = categories.find((c) => c.slug === pendingCategorySlug);
    if (match) {
      setForm((f) => (f.categoryId ? f : { ...f, categoryId: match.id }));
      setPendingCategorySlug(null);
    }
  }, [pendingCategorySlug, categories]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const onNameChange = (name: string) => {
    setForm((f) => ({ ...f, name, slug: slugTouched ? f.slug : deriveSlug(name, f.color) }));
  };

  const onColorChange = (color: string) => {
    setForm((f) => ({ ...f, color, slug: slugTouched ? f.slug : deriveSlug(f.name, color) }));
  };

  /** '' → null (not in the set); otherwise rupees → paise. NaN/negative → undefined (invalid). */
  const addonPaise = (rupees: string): number | null | undefined => {
    if (rupees.trim() === '') return null;
    const paise = Math.round(Number(rupees) * 100);
    return Number.isFinite(paise) && paise >= 0 ? paise : undefined;
  };

  const onPhotoPicked = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = ''; // allow re-selecting the same file (retake)
    if (!file) return;
    setUploading(true);
    try {
      const { publicUrl } = await uploadProductImage(file);
      set('imageUrl', publicUrl);
      toast('Photo uploaded');
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Photo upload failed', { tone: 'error' });
    } finally {
      setUploading(false);
    }
  };

  const onSubmit = async (e: FormEvent) => {
    e.preventDefault();
    setError(null);
    const price = Math.round(Number(form.priceRupees) * 100);
    if (!form.name.trim() || !form.slug.trim()) {
      setError('Name and slug are required');
      return;
    }
    if (!form.categoryId) {
      setError('Please choose a category');
      return;
    }
    if (!Number.isFinite(price) || price < 0 || form.priceRupees.trim() === '') {
      setError('Please enter a valid price in rupees');
      return;
    }
    const dupattaPrice = addonPaise(form.dupattaRupees);
    const jacketPrice = addonPaise(form.jacketRupees);
    if (dupattaPrice === undefined || jacketPrice === undefined) {
      setError('Set-includes prices must be 0 or more — leave blank when the set has no such piece');
      return;
    }

    const body = {
      name: form.name.trim(),
      slug: form.slug.trim(),
      categoryId: form.categoryId,
      description: form.description,
      details: form.details,
      price,
      color: form.color,
      flag: form.flag === '' ? null : form.flag,
      imageUrl: form.imageUrl.trim() === '' ? null : form.imageUrl.trim(),
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
              onChange={(e) => onNameChange(e.target.value)}
              required
            />
          </div>
          <div className="field">
            <label className="lab" htmlFor="p-slug">
              Slug
            </label>
            <input
              id="p-slug"
              className="inp"
              value={form.slug}
              onChange={(e) => {
                setSlugTouched(true);
                set('slug', e.target.value);
              }}
              required
            />
          </div>
        </div>

        <div className="grid2">
          <div className="field">
            <label className="lab" htmlFor="p-category">
              Category
            </label>
            <select
              id="p-category"
              className="inp"
              value={form.categoryId}
              onChange={(e) => set('categoryId', e.target.value)}
              required
            >
              <option value="">Select a category…</option>
              {categories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
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
              onChange={(e) => set('priceRupees', e.target.value)}
              required
            />
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
              onChange={(e) => onColorChange(e.target.value)}
            />
          </div>
          <div className="field">
            <label className="lab" htmlFor="p-flag">
              Flag
            </label>
            <select
              id="p-flag"
              className="inp"
              value={form.flag}
              onChange={(e) => set('flag', e.target.value as FormState['flag'])}
            >
              <option value="">None</option>
              <option value="bestseller">Bestseller</option>
              <option value="new">New</option>
            </select>
          </div>
        </div>

        <div className="grid2">
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
            <label className="lab" htmlFor="p-fabric">
              Fabric
            </label>
            <input
              id="p-fabric"
              className="inp"
              placeholder="e.g. Tissue"
              value={form.fabric}
              onChange={(e) => set('fabric', e.target.value)}
            />
          </div>
        </div>

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

        <p className="section-label">Photo</p>
        <div className="field">
          <input
            ref={photoInput}
            type="file"
            accept="image/*,.heic,.heif"
            hidden
            aria-label="Product photo file"
            onChange={(e) => void onPhotoPicked(e)}
          />
          <div className="photo-row">
            <button
              type="button"
              className="btn-outline fit"
              disabled={uploading}
              onClick={() => photoInput.current?.click()}
            >
              {uploading ? 'Uploading…' : form.imageUrl ? 'Replace photo' : 'Upload photo'}
            </button>
            {form.imageUrl && (
              <figure className="thumb">
                <img src={form.imageUrl} alt="Product photo preview" />
              </figure>
            )}
          </div>
        </div>
        <div className="field">
          <label className="lab" htmlFor="p-image">
            Image URL (or paste one directly)
          </label>
          <input
            id="p-image"
            className="inp"
            type="url"
            placeholder="https://…"
            value={form.imageUrl}
            onChange={(e) => set('imageUrl', e.target.value)}
          />
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
