import { useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { api } from '../lib/api';
import { displayPrice, displaySalePrice, effectiveBasePrice } from '../lib/format';
import { COLOR_FAMILY_META } from '../lib/types';
import type { ProductDetail, ProductImage, ProductSummary, ProductsResponse } from '../lib/types';
import { useCart } from '../lib/cart';
import { useSiteContent } from '../lib/content';
import { useWishlist } from '../lib/wishlist';
import { track } from '../lib/analytics';
import { useCartDrawer } from '../components/CartDrawer';
import { useToast } from '../components/Toast';
import Shop from '../components/Shop';
import ImageSlot from '../components/ImageSlot';
import StageCarousel from '../components/StageCarousel';
import type { GalleryTrigger } from '../components/StageCarousel';
import Price from '../components/Price';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import { usePageTitle } from '../lib/usePageTitle';
import '../styles/pdp.css';

/** Positional fallback when a gallery row carries no pose. */
const poseLabel = (img: ProductImage, i: number) => img.pose || `View ${i + 1}`;

export default function Product() {
  const { slug = '' } = useParams();
  const navigate = useNavigate();
  const cart = useCart();
  const { facts, footer } = useSiteContent();
  const wishlist = useWishlist();
  const { openDrawer } = useCartDrawer();
  const { showToast } = useToast();

  const [product, setProduct] = useState<ProductDetail | null>(null);
  usePageTitle(product?.name);
  const [related, setRelated] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const [thumb, setThumb] = useState(0);
  const [variantId, setVariantId] = useState('');
  const [qty, setQty] = useState(1);
  // Set pieces are included by default; unticking removes them from the price.
  const [incDupatta, setIncDupatta] = useState(false);
  const [incJacket, setIncJacket] = useState(false);
  // Made-to-measure note draft; survives variant flips, addToBag gates on the flag.
  const [measurements, setMeasurements] = useState('');

  const lastTrackedSlugRef = useRef<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    setError(null);
    setThumb(0);
    setQty(1);
    setMeasurements('');
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
        // An old (aliased) slug still resolves — canonicalise the address bar
        // so what gets copied and shared is the piece's current URL.
        if (detail.slug && detail.slug !== slug) {
          navigate(`/product/${detail.slug}`, { replace: true });
        }
        if (lastTrackedSlugRef.current !== detail.slug) {
          lastTrackedSlugRef.current = detail.slug;
          track('product_view', {
            productId: detail.id,
            props: { slug: detail.slug, name: detail.name, price: detail.price },
          });
        }
        setIncDupatta(detail.dupattaPrice != null);
        setIncJacket(detail.jacketPrice != null);
        // Made to order: every size is orderable, so the first chip (XS) is
        // simply the first choice — stock plays no part in selection.
        setVariantId(detail.variants[0]?.id ?? '');
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

  // Gallery rows when the piece has them, else the legacy denormalized single
  // image, else nothing (the placeholder slot renders).
  const gallery = useMemo<ProductImage[]>(() => {
    if (!product) return [];
    if (product.images.length) return product.images;
    return product.imageUrl ? [{ url: product.imageUrl, pose: '' }] : [];
  }, [product]);

  // A shorter gallery (product switch, edited piece) must not strand `thumb`
  // past its end — the per-slug effect above only covers navigation.
  useEffect(() => {
    setThumb((t) => (t < gallery.length ? t : 0));
  }, [gallery.length]);

  // Single path for every gallery move — thumbnail click, swipe, drag, dot.
  const onGalleryChange = (i: number, trigger: GalleryTrigger) => {
    if (i !== thumb && product) {
      track('gallery_image_change', {
        productId: product.id,
        props: {
          slug: product.slug,
          index: i,
          pose: gallery[i] ? poseLabel(gallery[i], i) : '',
          trigger,
        },
      });
    }
    setThumb(i);
  };

  const selectedVariant = product?.variants.find((v) => v.id === variantId);
  const isMadeToMeasure = selectedVariant?.size === 'Custom';
  const detailLines = useMemo(
    () =>
      (product?.details ?? '')
        .split('\n')
        .map((l) => l.trim())
        .filter(Boolean),
    [product],
  );

  const chosenDupatta = product && incDupatta && product.dupattaPrice != null ? product.dupattaPrice : null;
  const chosenJacket = product && incJacket && product.jacketPrice != null ? product.jacketPrice : null;
  const chosenAddons = (chosenDupatta ?? 0) + (chosenJacket ?? 0);
  // A sale discounts the base only; add-ons are always charged in full. This is
  // the number checkout independently recomputes from getVariantsForUpdate.
  const liveTotal = product ? effectiveBasePrice(product) + chosenAddons : 0;
  const onSale = product ? displaySalePrice(product) != null : false;
  const preSaleTotal = product ? product.price + chosenAddons : 0;

  const addToBag = () => {
    if (!product || !selectedVariant) return;
    cart.add(
      {
        variantId: selectedVariant.id,
        productId: product.id,
        productSlug: product.slug,
        name: product.name,
        size: selectedVariant.size,
        color: product.color,
        unitPrice: liveTotal,
        imageUrl: product.imageUrl,
        includeDupatta: chosenDupatta != null,
        includeJacket: chosenJacket != null,
        dupattaPrice: chosenDupatta,
        jacketPrice: chosenJacket,
        measurements: isMadeToMeasure ? measurements.trim() : '',
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
            {gallery.length > 0 ? (
              gallery.map((img, i) => (
                <ImageSlot
                  key={`${img.url}-${i}`}
                  className={i === thumb ? 'active' : ''}
                  src={img.url}
                  label={poseLabel(img, i)}
                  alt={`${product.name} — ${poseLabel(img, i)}`}
                  onClick={() => onGalleryChange(i, 'thumb')}
                />
              ))
            ) : (
              <ImageSlot className="active" label="View 1" alt={`${product.name} — View 1`} />
            )}
          </div>
          <div className="stage">
            <div className="flag">
              {product.flag === 'bestseller' && <span>Bestseller</span>}
              {product.flag === 'new' && <span>New</span>}
              {product.flag === 'sale' && <span>Sale</span>}
              <span>Made to Order</span>
            </div>
            <StageCarousel
              images={gallery}
              index={thumb}
              productName={product.name}
              poseLabel={poseLabel}
              onIndexChange={onGalleryChange}
            />
          </div>
        </div>

        <div className="info">
          <div className="brandline">{product.collection || 'Tanvi Agnihotry'}</div>
          <h1>{product.name}</h1>
          <div className="price">
            {onSale && (
              <s className="was">
                <Price paise={preSaleTotal} />
              </s>
            )}
            <Price paise={liveTotal} /> <span className="tax">incl. of all taxes</span>
          </div>
          <p className="desc">{product.description}</p>

          <div className="divline"></div>

          <div className="opt-label">
            <span>
              Colour — <strong id="colorName">{product.color}</strong>
            </span>
          </div>
          {product.colorFamily && (
            <div className="swatches" id="swatches">
              {/* One truthful dot: this piece's colour family. Other colourways
                  are separate pieces, not options on this page. */}
              <span
                className="swatch active"
                title={product.color}
                aria-hidden="true"
                style={{ background: COLOR_FAMILY_META[product.colorFamily].swatch }}
              />
            </div>
          )}

          <div className="opt-label">
            <span>Size</span>
            <span className="help" onClick={() => navigate('/size-guide')}>
              Size &amp; Fit Guide
            </span>
          </div>
          <div className="sizes" id="sizes">
            {product.variants.map((v) => {
              // The Custom variant IS the made-to-measure option — a real,
              // orderable size chip, not a detour to the contact page.
              const custom = v.size === 'Custom';
              return (
                <button
                  key={v.id}
                  className={`size${custom ? ' custom' : ''}${v.id === variantId ? ' active' : ''}`}
                  onClick={() => {
                    setVariantId(v.id);
                    track('variant_select', { productId: product.id, props: { variantId: v.id, size: v.size } });
                  }}
                >
                  {custom ? 'Made to Measure' : v.size}
                </button>
              );
            })}
          </div>

          {(product.dupattaPrice != null || product.jacketPrice != null) && (
            <>
              <div className="opt-label">
                <span>This piece includes</span>
              </div>
              <div className="set-includes">
                {product.dupattaPrice != null && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={incDupatta}
                      onChange={(e) => setIncDupatta(e.target.checked)}
                    />
                    Dupatta —{' '}
                    {product.dupattaPrice === 0 ? 'Included' : <Price paise={product.dupattaPrice} />}
                  </label>
                )}
                {product.jacketPrice != null && (
                  <label className="check">
                    <input
                      type="checkbox"
                      checked={incJacket}
                      onChange={(e) => setIncJacket(e.target.checked)}
                    />
                    Jacket —{' '}
                    {product.jacketPrice === 0 ? 'Included' : <Price paise={product.jacketPrice} />}
                  </label>
                )}
              </div>
            </>
          )}

          {isMadeToMeasure && (
            <div className="mtm-panel">
              <p>
                <strong>Made to measure.</strong> After you place your order, our atelier will
                reach out over call and WhatsApp within 48 hours to take your measurements.
              </p>
              <label className="mtm-label" htmlFor="mtmNotes">
                Share measurements or notes (optional)
              </label>
              <textarea
                id="mtmNotes"
                maxLength={500}
                rows={3}
                placeholder="e.g. bust 36in, waist 30in, height 5'6&quot; — or anything we should know"
                value={measurements}
                onChange={(e) => setMeasurements(e.target.value)}
              />
            </div>
          )}

          <div className="mto">
            <span className="dot"></span>
            <p>
              <strong>Made to order.</strong> Each piece is crafted on commission and dispatched in{' '}
              {facts.leadStandard}. Questions? Call us before ordering at{' '}
              <a href={`tel:+${facts.phone.replace(/\D/g, '')}`}>{facts.phone}</a>
              {footer.whatsappUrl && (
                <>
                  {' '}
                  or on{' '}
                  <a href={footer.whatsappUrl} target="_blank" rel="noreferrer">
                    WhatsApp
                  </a>
                </>
              )}
              .
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
              {(product.craft || product.fabric || product.occasion) && (
                <ul className="specs">
                  {product.craft && (
                    <li>
                      <strong>Craft</strong> — {product.craft}
                    </li>
                  )}
                  {product.fabric && (
                    <li>
                      <strong>Fabric</strong> — {product.fabric}
                    </li>
                  )}
                  {product.occasion && (
                    <li>
                      <strong>Occasion</strong> — {product.occasion}
                    </li>
                  )}
                </ul>
              )}
              {detailLines.length > 0 ? (
                <ul>
                  {detailLines.map((line) => (
                    <li key={line}>{line}</li>
                  ))}
                </ul>
              ) : (
                <ul>
                  <li>Hand-embroidered in our Jaipur atelier</li>
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
              Crafted on commission in our atelier. Standard sizes ship in {facts.leadStandard};
              made-to-measure in {facts.leadCustom}. Our team will reach out over call and
              WhatsApp within 48 hours of your order to take measurements.
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

          {/* Provenance — the four facts nobody can copy (audit §06). Rendered
              only when the atelier has filled them in; never invented. */}
          {(product.karigarName || product.hoursWorked != null || product.techniques || product.finishedOn) && (
            <div className="provenance">
              <span className="eyebrow">Provenance</span>
              <p>
                {[
                  product.karigarName && `Made by ${product.karigarName} in Bapu Nagar, Jaipur`,
                  product.hoursWorked != null && `${product.hoursWorked} hours of hand-work`,
                  product.techniques,
                  product.finishedOn &&
                    `finished ${new Date(product.finishedOn).toLocaleDateString('en-IN', { month: 'long', year: 'numeric' })}`,
                ]
                  .filter(Boolean)
                  .join(' · ')}
              </p>
            </div>
          )}
        </div>
      </main>

      {/* CRAFT BAND — no invented numbers: small true facts age better than
          big round ones (audit §03). */}
      <section className="craft">
        <div className="craft-grid">
          <ImageSlot label="Atelier / embroidery close-up" />
          <div>
            <span className="eyebrow">The Making</span>
            <h2>One workroom. One pair of hands.</h2>
            <p>
              Every piece begins as a single length of silk in our Bapu Nagar workroom. A karigar
              maps each motif, lays the thread, and sets every knot by hand — a slow craft we
              refuse to rush.
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
                    {displaySalePrice(r) != null && (
                      <s className="was">
                        <Price paise={displayPrice(r)} />
                      </s>
                    )}
                    <Price paise={displaySalePrice(r) ?? displayPrice(r)} />
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
