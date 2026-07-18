import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { ProductDetail, ProductSummary, ProductsResponse } from '../lib/types';
import { useCart } from '../lib/cart';
import { useWishlist } from '../lib/wishlist';
import { track } from '../lib/analytics';
import { useCartDrawer } from '../components/CartDrawer';
import { useToast } from '../components/Toast';
import Shop from '../components/Shop';
import ImageSlot from '../components/ImageSlot';
import Price from '../components/Price';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/pdp.css';

const COLOR_CLASS: Record<string, string> = {
  Sage: 'c-sage',
  Moss: 'c-moss',
  Pistachio: 'c-pistachio',
  'Antique Gold': 'c-antique-gold',
  'Deep Forest': 'c-deep-forest',
  Eucalyptus: 'c-eucalyptus',
  Celadon: 'c-celadon',
  Mint: 'c-mint',
};
const SWATCH_PALETTE = ['Sage', 'Moss', 'Antique Gold', 'Deep Forest'];
const THUMB_LABELS = ['View 1', 'View 2', 'Detail', 'Back'];

export default function Product() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const cart = useCart();
  const wishlist = useWishlist();
  const { openDrawer } = useCartDrawer();
  const { showToast } = useToast();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  const [related, setRelated] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [thumb, setThumb] = useState(0);
  const [color, setColor] = useState('');
  const [variantId, setVariantId] = useState('');
  const [qty, setQty] = useState(1);

  const lastTrackedSlugRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setThumb(0);
    setQty(1);
    api
      .get<ProductDetail | { product: ProductDetail; related?: ProductSummary[] }>(
        `/api/products/${encodeURIComponent(slug)}`,
      )
      .then(async (raw) => {
        const detail = 'product' in raw && raw.product ? raw.product : (raw as ProductDetail);
        const rel =
          ('related' in raw ? raw.related : undefined) ?? detail.related ?? [];
        if (cancelled) return;
        setProduct(detail);
        if (lastTrackedSlugRef.current !== detail.slug) {
          lastTrackedSlugRef.current = detail.slug;
          track('product_view', {
            productId: detail.id,
            props: { slug: detail.slug, name: detail.name, price: detail.price },
          });
        }
        setColor(detail.color);
        const firstInStock = detail.variants.find((v) => v.stock > 0) ?? detail.variants[0];
        setVariantId(firstInStock?.id ?? '');
        if (rel.length) {
          setRelated(rel.filter((r) => r.id !== detail.id).slice(0, 4));
        } else {
          try {
            const more = await api.get<ProductsResponse>(
              `/api/products?category=${encodeURIComponent(detail.categorySlug)}&page=1&limit=5`,
            );
            if (!cancelled) {
              setRelated(more.items.filter((r) => r.id !== detail.id).slice(0, 4));
            }
          } catch {
            /* related is decorative */
          }
        }
      })
      .catch((e: { status?: number; message?: string }) => {
        if (!cancelled) {
          setError(
            e.status === 404
              ? 'This piece has moved or never existed.'
              : (e.message ?? 'Unable to load this piece right now.'),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [slug]);

  const swatches = useMemo(() => {
    if (!product) return SWATCH_PALETTE;
    return SWATCH_PALETTE.includes(product.color)
      ? SWATCH_PALETTE
      : [product.color, ...SWATCH_PALETTE.slice(0, 3)];
  }, [product]);

  const selectedVariant = product?.variants.find((v) => v.id === variantId);
  const detailLines = useMemo(
    () =>
      (product?.details ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    [product],
  );

  const addToBag = () => {
    if (!product || !selectedVariant) return;
    cart.add(
      {
        variantId: selectedVariant.id,
        productId: product.id,
        productSlug: product.slug,
        name: product.name,
        size: selectedVariant.size,
        color,
        unitPrice: product.price,
        imageUrl: product.imageUrl,
      },
      qty,
    );
    showToast('Added to your bag');
    openDrawer();
  };

  const saved = product ? wishlist.has(product.id) : false;

  if (loading) {
    return (
      <Shop page="page-pdp">
        <p className="api-note">Preparing the piece…</p>
      </Shop>
    );
  }
  if (error || !product) {
    return (
      <Shop page="page-pdp">
        <p className="api-note err">{error ?? 'Unable to load this piece right now.'}</p>
      </Shop>
    );
  }

  return (
    <Shop page="page-pdp">
      <div className="crumbs">
        <Link to="/">Home</Link>
        <span className="sep">/</span>
        <Link to={`/collection/${product.categorySlug}`}>{product.categoryName}</Link>
        <span className="sep">/</span>
        <span className="here">{product.name}</span>
      </div>

      {/* PDP */}
      <main className="pdp">
        <div className="gallery">
          <div className="thumbs" id="thumbs">
            {THUMB_LABELS.map((label, i) => (
              <ImageSlot
                key={label}
                className={i === thumb ? 'active' : ''}
                src={i === 0 ? product.imageUrl : null}
                label={label}
                alt={`${product.name} — ${label}`}
                onClick={() => setThumb(i)}
              />
            ))}
          </div>
          <div className="stage">
            <div className="flag">
              {product.flag === 'bestseller' && <span>Bestseller</span>}
              {product.flag === 'new' && <span>New</span>}
              <span>Made to Order</span>
            </div>
            <ImageSlot
              src={thumb === 0 ? product.imageUrl : null}
              label={thumb === 0 ? product.name : THUMB_LABELS[thumb]}
              alt={product.name}
            />
          </div>
        </div>

        <div className="info">
          <div className="brandline">The Verdant Edit</div>
          <h1>{product.name}</h1>
          <div className="price">
            <Price paise={product.price} /> <span className="tax">incl. of all taxes</span>
          </div>
          <p className="desc">{product.description}</p>

          <div className="divline"></div>

          <div className="opt-label">
            <span>
              Colour — <strong id="colorName">{color}</strong>
            </span>
          </div>
          <div className="swatches" id="swatches">
            {swatches.map((c) => (
              <button
                key={c}
                className={`swatch ${COLOR_CLASS[c] ?? 'c-default'}${c === color ? ' active' : ''}`}
                aria-label={c}
                title={c}
                onClick={() => {
                  setColor(c);
                  track('color_select', { productId: product.id, props: { color: c } });
                }}
              />
            ))}
          </div>

          <div className="opt-label">
            <span>Size</span>
            <span className="help" onClick={() => navigate('/size-guide')}>
              Size &amp; Fit Guide
            </span>
          </div>
          <div className="sizes" id="sizes">
            {product.variants.map((v) => (
              <button
                key={v.id}
                className={`size${v.id === variantId ? ' active' : ''}`}
                disabled={v.stock === 0}
                onClick={() => {
                  setVariantId(v.id);
                  track('variant_select', { productId: product.id, props: { variantId: v.id, size: v.size } });
                }}
              >
                {v.size}
              </button>
            ))}
            <button className="size custom" onClick={() => navigate('/contact')}>
              Made to Measure
            </button>
          </div>

          <div className="mto">
            <span className="dot"></span>
            <p>
              <strong>Made to order.</strong> Each piece is crafted on commission and dispatched in
              4–6 weeks. Book a complimentary virtual fitting for a made-to-measure cut.
            </p>
          </div>

          <div className="buy-row">
            <div className="qty">
              <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))}>
                −
              </button>
              <span className="val">{qty}</span>
              <button type="button" onClick={() => setQty((q) => q + 1)}>
                +
              </button>
            </div>
            <button className="btn-buy" id="addBtn" onClick={addToBag} disabled={!selectedVariant}>
              Add to Bag
            </button>
          </div>
          <button className="btn-outline wish" onClick={() => wishlist.toggle(product.id)}>
            {saved ? '♥' : '♡'} &nbsp; {saved ? 'Saved to Wishlist' : 'Add to Wishlist'}
          </button>

          <details className="acc" open>
            <summary>
              Details &amp; Composition <span className="ic">+</span>
            </summary>
            <div className="acc-body">
              {detailLines.length > 0 ? (
                <ul>
                  {detailLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <ul>
                  <li>Hand-embroidered in our Mumbai atelier</li>
                  <li>Concealed side zip · cotton-silk lining</li>
                  <li>Dry clean only · handle embroidery with care</li>
                </ul>
              )}
            </div>
          </details>
          <details className="acc">
            <summary>
              Made to Order &amp; Fittings <span className="ic">+</span>
            </summary>
            <div className="acc-body">
              Crafted on commission in our atelier. Standard sizes ship in 4–6 weeks;
              made-to-measure in 6–8 weeks following a virtual fitting. Our team will be in touch
              within 48 hours of order to confirm measurements.
            </div>
          </details>
          <details className="acc">
            <summary>
              Shipping &amp; Returns <span className="ic">+</span>
            </summary>
            <div className="acc-body">
              Complimentary insured shipping worldwide. As each piece is made to order, we offer
              exchanges and store credit rather than refunds. Made-to-measure pieces are final
              sale.
            </div>
          </details>
        </div>
      </main>

      {/* CRAFT BAND */}
      <section className="craft">
        <div className="craft-grid">
          <ImageSlot label="Atelier / embroidery close-up" />
          <div>
            <span className="eyebrow">The Making</span>
            <h2>Three hundred hours, by hand.</h2>
            <p>
              Every Verdant Edit piece begins as a single length of tissue. Our karigars map each
              motif, lay the zardozi, and set every sequin by hand — a slow craft we refuse to
              rush.
            </p>
          </div>
        </div>
      </section>

      {/* RELATED */}
      {related.length > 0 && (
        <section className="related">
          <div className="head-center">
            <span className="eyebrow">Complete the Look</span>
            <h2>You may also love</h2>
          </div>
          <div className="rel-grid">
            {related.map((r) => (
              <Link className="rel" key={r.id} to={`/product/${r.slug}`}>
                <ImageSlot src={r.imageUrl} label={r.name} alt={r.name} />
                <div className="m">
                  <div className="nm">{r.name}</div>
                  <div className="pr">
                    <Price paise={r.price} />
                  </div>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}
      <Reveal watch={`${product.id}:${related.length}`} />
      <Ambient watch={product.id} />
    </Shop>
  );
}
