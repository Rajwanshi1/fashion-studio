import { useEffect, useState } from 'react';
import type { FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { AdminProduct, Category, Variant } from '../lib/types';
import { useToast } from '../components/Toast';

const NEW_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'Custom'];

function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

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
  const [pendingCategorySlug, setPendingCategorySlug] = useState<string | null>(null);

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
    api<AdminProduct>(`/api/admin/products/${id}`)
      .then((product) => {
        if (!live) return;
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
        });
        setSlugTouched(true);
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
    setForm((f) => ({ ...f, name, slug: slugTouched ? f.slug : slugify(name) }));
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
        const updates = variants
          .filter((v) => Math.max(0, Math.round(Number(stocks[v.id]) || 0)) !== v.stock)
          .map((v) => ({
            variantId: v.id,
            stock: Math.max(0, Math.round(Number(stocks[v.id]) || 0)),
          }));
        if (updates.length > 0) {
          await api(`/api/admin/products/${id}/variants`, { method: 'PATCH', body: { updates } });
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
              onChange={(e) => set('color', e.target.value)}
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

        <div className="field">
          <label className="lab" htmlFor="p-image">
            Image URL (optional)
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
