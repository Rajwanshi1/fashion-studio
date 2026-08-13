import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { track } from '../lib/analytics';
import { displayPrice } from '../lib/format';
import type { Category, ColorFamily, ProductSort, ProductsResponse, ProductSummary } from '../lib/types';
import { COLOR_FAMILIES, COLOR_FAMILY_META } from '../lib/types';
import Shop from '../components/Shop';
import ProductCard from '../components/ProductCard';
import ImageSlot from '../components/ImageSlot';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/plp.css';
import { usePageTitle } from '../lib/usePageTitle';

const SIZES = ['XS', 'S', 'M', 'L', 'XL', 'Custom'];
const OCCASIONS = ['Wedding', 'Reception', 'Festive', 'Cocktail'];
/** Heading and sidebar label for the slugless route — the whole catalogue. */
const ALL_PIECES = 'All Pieces';
const PRICE_MIN = 50000; // rupees
const PRICE_MAX = 300000; // rupees

const SORT_OPTIONS: Array<{ value: string; label: string }> = [
  { value: 'featured', label: 'Featured' },
  { value: 'new', label: 'New Arrivals' },
  { value: 'price_asc', label: 'Price — Low to High' },
  { value: 'price_desc', label: 'Price — High to Low' },
  { value: 'bestselling', label: 'Bestselling' },
];

export default function Collection() {
  usePageTitle('The Collection');
  const { categorySlug = '' } = useParams();
  const [params, setParams] = useSearchParams();
  const navigate = useNavigate();

  const sort = params.get('sort') ?? 'featured';
  const page = Math.max(1, Number(params.get('page') ?? '1') || 1);
  const collection = params.get('collection') ?? '';
  // Server-side filter, single-select. The API validates the token against the
  // 12 colour families, so an arbitrary ?color= simply 400s rather than lying.
  const color = params.get('color') ?? '';

  const [cats, setCats] = useState<Category[]>([]);
  const [collectionNames, setCollectionNames] = useState<string[]>([]);
  const [data, setData] = useState<ProductsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [filtersOpen, setFiltersOpen] = useState(false);
  const [sizes, setSizes] = useState<string[]>([]);
  const [occasions, setOccasions] = useState<string[]>([]);
  const [priceMax, setPriceMax] = useState(PRICE_MAX);

  useEffect(() => {
    api
      .get<Category[] | { items: Category[] }>('/api/categories')
      .then((d) => setCats(Array.isArray(d) ? d : d.items))
      .catch(() => setCats([]));
    api
      .get<string[]>('/api/collections')
      .then((d) => setCollectionNames(Array.isArray(d) ? d : []))
      .catch(() => setCollectionNames([]));
  }, []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    const apiSort: ProductSort = sort === 'bestselling' ? 'featured' : (sort as ProductSort);
    const collectionParam = collection ? `&collection=${encodeURIComponent(collection)}` : '';
    const colorParam = color ? `&color=${encodeURIComponent(color)}` : '';
    api
      .get<ProductsResponse>(
        `/api/products?category=${encodeURIComponent(categorySlug)}&sort=${apiSort}&page=${page}&limit=12${collectionParam}${colorParam}`,
      )
      .then((d) => {
        if (!cancelled) setData(d);
      })
      .catch((e: { message?: string }) => {
        if (!cancelled) setError(e.message ?? 'Unable to load pieces right now.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [categorySlug, sort, page, collection, color]);

  // No slug in the route means every piece. The fetch above already sends an
  // empty `category=`, which catalog.service.ts normalises away, so the only
  // thing that needs saying here is what to call it on screen.
  const allPieces = categorySlug === '';
  const category = cats.find((c) => c.slug === categorySlug);
  const categoryName = allPieces
    ? ALL_PIECES
    : (category?.name ??
      categorySlug
        .split('-')
        .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
        .join(' '));

  const items = useMemo(() => {
    let list = data?.items ?? [];
    if (occasions.length) list = list.filter((p) => occasions.includes(p.occasion));
    if (priceMax < PRICE_MAX) list = list.filter((p) => displayPrice(p) <= priceMax * 100);
    return list;
  }, [data, occasions, priceMax]);

  // Value-based guard (not a one-shot boolean): a plain "have we run before"
  // flag is inverted by StrictMode's mount double-invoke (invocation 1 flips
  // it false and bails, invocation 2 then sees it false and arms a spurious
  // timer for the *initial* values). Comparing against a snapshot of the
  // last-tracked filter state is immune to that, the same way product_view's
  // slug ref is: both StrictMode invocations see the snapshot still matches
  // the initial values and bail, and the snapshot only advances once an
  // event actually fires.
  const lastFilterRef = useRef<{ color: string; occasions: string[]; priceMax: number; collection: string }>({
    color,
    occasions,
    priceMax,
    collection,
  });
  useEffect(() => {
    const last = lastFilterRef.current;
    const sameList = (a: string[], b: string[]) => a.length === b.length && a.every((v, i) => v === b[i]);
    if (
      last.color === color &&
      sameList(last.occasions, occasions) &&
      last.priceMax === priceMax &&
      last.collection === collection
    ) {
      return;
    }
    const t = setTimeout(() => {
      lastFilterRef.current = { color, occasions, priceMax, collection };
      track('filter_apply', { props: { category: categorySlug, color, occasions, priceMax, collection } });
    }, 500);
    return () => clearTimeout(t);
    // categorySlug intentionally excluded: only filter changes should re-arm
    // the debounce, not a category navigation on its own.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [color, occasions, priceMax, collection]);

  const toggleIn = (list: string[], v: string) =>
    list.includes(v) ? list.filter((x) => x !== v) : [...list, v];

  /** Set/clear the server-filter search params in one go; any change resets paging. */
  const patchParams = (patch: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(patch)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    next.delete('page');
    setParams(next);
  };

  const setCollection = (name: string) => patchParams({ collection: name });
  const setColor = (token: string) => patchParams({ color: token });

  /**
   * Category lives in the route rather than the query string, so switching it is
   * a navigation. An empty slug lands on the slugless route — the whole
   * catalogue — which is how the category gets cleared. The refinement params
   * ride along and paging resets, matching patchParams.
   */
  const goToCategory = (slug: string) => {
    const next = new URLSearchParams(params);
    next.delete('page');
    const qs = next.toString();
    navigate(`${slug ? `/collection/${slug}` : '/collection'}${qs ? `?${qs}` : ''}`);
  };

  const clearAll = () => {
    setSizes([]);
    setOccasions([]);
    setPriceMax(PRICE_MAX);
    if (collection || color) patchParams({ collection: '', color: '' });
  };

  const setSort = (v: string) => {
    track('sort_change', { props: { category: categorySlug, sort: v } });
    const next = new URLSearchParams(params);
    next.set('sort', v);
    next.delete('page');
    setParams(next);
  };
  const setPage = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
    window.scrollTo(0, 0);
  };

  const pages = data?.pages ?? 1;
  const total = data?.total ?? 0;
  // Colour and collection are server filters, so `total` still describes the
  // rendered set; only the client-side filters make it stale.
  const hasClientFilters = sizes.length > 0 || occasions.length > 0 || priceMax < PRICE_MAX;
  const colorMeta = color ? COLOR_FAMILY_META[color as ColorFamily] : undefined;

  const cards: ProductSummary[] = items;

  return (
    <Shop page="page-plp">
      <div className="crumbs">
        <Link to="/">Home</Link>
        <span className="sep">/</span>
        <Link to="/collections">Collections</Link>
        <span className="sep">/</span>
        <span className="here">{categoryName}</span>
      </div>

      <div className="page-hero">
        <span className="eyebrow">The Verdant Edit</span>
        <h1>{categoryName}</h1>
        <p>
          {category?.description ??
            'Hand-embroidered indo-western pieces in moss, sage and pistachio — structured, fluid, and made to order in our atelier.'}
        </p>
      </div>

      <main className="plp">
        <button
          className={`filter-toggle${filtersOpen ? ' open' : ''}`}
          onClick={() => setFiltersOpen((o) => !o)}
        >
          Filter &amp; Refine <span className="ic">+</span>
        </button>

        {/* SIDEBAR */}
        <aside className={`filters${filtersOpen ? ' show' : ''}`}>
          <div className="fgroup">
            <h4>Category</h4>
            <label className="fopt">
              <input type="checkbox" checked={allPieces} onChange={() => goToCategory('')} />{' '}
              {ALL_PIECES}
            </label>
            {(cats.length
              ? cats
              : // Categories failed to load: keep the current one visible so it can
                // still be cleared. On the slugless route there is nothing to stand in for.
                allPieces
                ? []
                : [{ id: categorySlug, slug: categorySlug, name: categoryName, description: '', position: 0 }]
            ).map((c) => (
              <label className="fopt" key={c.slug}>
                <input
                  type="checkbox"
                  checked={c.slug === categorySlug}
                  onChange={() => goToCategory(c.slug === categorySlug ? '' : c.slug)}
                />{' '}
                {c.name}{' '}
                {c.productCount != null && <span className="ct">{c.productCount}</span>}
              </label>
            ))}
          </div>
          <div className="fgroup">
            <h4>Colour</h4>
            <div className="fcolors">
              {COLOR_FAMILIES.map((token) => {
                const meta = COLOR_FAMILY_META[token];
                return (
                  <button
                    key={token}
                    className={`sw${color === token ? ' on' : ''}`}
                    style={{ background: meta.swatch }}
                    title={meta.label}
                    aria-label={meta.label}
                    onClick={() => setColor(color === token ? '' : token)}
                  />
                );
              })}
            </div>
          </div>
          <div className="fgroup">
            <h4>Size</h4>
            <div className="fsizes">
              {SIZES.map((s) => (
                <button
                  key={s}
                  className={`fsize${sizes.includes(s) ? ' on' : ''}`}
                  onClick={() => setSizes((prev) => toggleIn(prev, s))}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
          {collectionNames.length > 0 && (
            <div className="fgroup">
              <h4>Collection</h4>
              {collectionNames.map((name) => (
                <label className="fopt" key={name}>
                  <input
                    type="checkbox"
                    checked={collection === name}
                    onChange={() => setCollection(collection === name ? '' : name)}
                  />{' '}
                  {name}
                </label>
              ))}
            </div>
          )}
          <div className="fgroup">
            <h4>Occasion</h4>
            {OCCASIONS.map((o) => (
              <label className="fopt" key={o}>
                <input
                  type="checkbox"
                  checked={occasions.includes(o)}
                  onChange={() => setOccasions((prev) => toggleIn(prev, o))}
                />{' '}
                {o}
              </label>
            ))}
          </div>
          <div className="fgroup">
            <h4>Price</h4>
            <div className="frange">
              <span>₹50,000</span>
              <input
                type="range"
                min={PRICE_MIN}
                max={PRICE_MAX}
                value={priceMax}
                onChange={(e) => setPriceMax(Number(e.target.value))}
                style={{ flex: 1, accentColor: 'var(--forest-700)' }}
                aria-label="Maximum price"
              />
              <span>₹3,00,000+</span>
            </div>
          </div>
        </aside>

        {/* RESULTS */}
        <section>
          <div className="plp-bar">
            <span className="count">
              {loading ? 'Loading…' : `${hasClientFilters ? cards.length : total} Pieces`}
            </span>
            <div className="sort">
              <label htmlFor="sort">Sort</label>
              <select id="sort" value={sort} onChange={(e) => setSort(e.target.value)}>
                {SORT_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
          </div>

          <div className="active-chips">
            {!allPieces && (
              <span className="ac">
                {categoryName}{' '}
                <button aria-label={`Remove ${categoryName}`} onClick={() => goToCategory('')}>
                  ✕
                </button>
              </span>
            )}
            {colorMeta && (
              <span className="ac">
                {colorMeta.label}{' '}
                <button aria-label={`Remove ${colorMeta.label}`} onClick={() => setColor('')}>
                  ✕
                </button>
              </span>
            )}
            {sizes.map((s) => (
              <span className="ac" key={s}>
                Size {s}{' '}
                <button aria-label={`Remove size ${s}`} onClick={() => setSizes((p) => toggleIn(p, s))}>
                  ✕
                </button>
              </span>
            ))}
            {occasions.map((o) => (
              <span className="ac" key={o}>
                {o}{' '}
                <button aria-label={`Remove ${o}`} onClick={() => setOccasions((p) => toggleIn(p, o))}>
                  ✕
                </button>
              </span>
            ))}
            {collection && (
              <span className="ac">
                {collection}{' '}
                <button aria-label={`Remove collection ${collection}`} onClick={() => setCollection('')}>
                  ✕
                </button>
              </span>
            )}
            {priceMax < PRICE_MAX && (
              <span className="ac">
                Under ₹{priceMax.toLocaleString('en-IN')}{' '}
                <button aria-label="Remove price filter" onClick={() => setPriceMax(PRICE_MAX)}>
                  ✕
                </button>
              </span>
            )}
            {(hasClientFilters || collection !== '' || color !== '') && (
              <button className="clear" onClick={clearAll}>
                Clear all
              </button>
            )}
          </div>

          {error ? (
            <p className="api-note err">{error}</p>
          ) : loading ? (
            <p className="api-note">Preparing the edit…</p>
          ) : cards.length === 0 ? (
            <p className="api-note">No pieces match — try easing a filter.</p>
          ) : (
            <div className="pgrid cols-2">
              {cards.map((p, i) => (
                <Fragment key={p.id}>
                  <ProductCard product={p} />
                  {i === 1 && (
                    <div className="promo-tile">
                      <ImageSlot label="Editorial campaign" />
                      <div className="pt">
                        <span className="eyebrow">Made to Order</span>
                        <h3>Cut to your measure, finished by hand.</h3>
                        <Link
                          className="btn btn-line"
                          style={{ color: 'var(--celadon-100)', borderColor: 'var(--gold-soft)' }}
                          to="/contact"
                        >
                          Book a Fitting →
                        </Link>
                      </div>
                    </div>
                  )}
                </Fragment>
              ))}
            </div>
          )}

          {pages > 1 && (
            <nav className="pager">
              <a
                className="arrow"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (page > 1) setPage(page - 1);
                }}
              >
                ← Prev
              </a>
              {Array.from({ length: pages }, (_, i) => i + 1).map((p) => (
                <a
                  key={p}
                  className={p === page ? 'on' : undefined}
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setPage(p);
                  }}
                >
                  {p}
                </a>
              ))}
              <a
                className="arrow"
                href="#"
                onClick={(e) => {
                  e.preventDefault();
                  if (page < pages) setPage(page + 1);
                }}
              >
                Next →
              </a>
            </nav>
          )}
        </section>
      </main>
      <Reveal watch={cards.length} />
      <Ambient watch={cards.length} />
    </Shop>
  );
}
