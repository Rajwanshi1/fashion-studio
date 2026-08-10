import { Fragment, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { MARQUEE_MIN_CHARS, fillTrack, useSiteContent } from '../lib/content';
import { displayPrice } from '../lib/format';
import type { Category, ProductDetail, ProductSummary, ProductsResponse } from '../lib/types';
import { useCart } from '../lib/cart';
import { useCartDrawer } from '../components/CartDrawer';
import { useToast } from '../components/Toast';
import { track } from '../lib/analytics';
import Nav from '../components/Nav';
import Footer from '../components/Footer';
import ImageSlot from '../components/ImageSlot';
import Price from '../components/Price';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/home.css';

const FALLBACK_CATS: Array<Pick<Category, 'slug' | 'name'>> = [
  { slug: 'lehenga', name: 'Lehenga' },
  { slug: 'anarkali', name: 'Anarkali' },
  { slug: 'suits', name: 'Suits' },
  { slug: 'kaftan', name: 'Kaftan' },
];

export default function Home() {
  const [cats, setCats] = useState<Array<Pick<Category, 'slug' | 'name'>>>(FALLBACK_CATS);
  const [best, setBest] = useState<ProductSummary[]>([]);
  const site = useSiteContent();
  // One copy of the marquee has to span the strip before it can be doubled into
  // a seamless loop — a one- or two-line marquee is repeated up to the length
  // the band was drawn for.
  const marquee = fillTrack(site.marquee.items, MARQUEE_MIN_CHARS);
  const cart = useCart();
  const { openDrawer } = useCartDrawer();
  const { showToast } = useToast();
  const navigate = useNavigate();

  useEffect(() => {
    let cancelled = false;
    api
      .get<Category[] | { items: Category[] }>('/api/categories')
      .then((data) => {
        const list = Array.isArray(data) ? data : data.items;
        if (!cancelled && list?.length) {
          setCats([...list].sort((a, b) => a.position - b.position).slice(0, 4));
        }
      })
      .catch(() => undefined);
    api
      .get<ProductsResponse>('/api/products?sort=featured&page=1&limit=4')
      .then((data) => {
        if (!cancelled) setBest(data.items.slice(0, 4));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  const quickAdd = async (p: ProductSummary) => {
    try {
      const raw = await api.get<ProductDetail | { product: ProductDetail }>(
        `/api/products/${p.slug}`,
      );
      const detail = 'product' in raw && raw.product ? raw.product : (raw as ProductDetail);
      const variant = detail.variants.find((v) => v.stock > 0) ?? detail.variants[0];
      if (!variant) {
        navigate(`/product/${p.slug}`);
        return;
      }
      // Quick adds default to the full set — every piece included.
      cart.add({
        variantId: variant.id,
        productId: detail.id,
        productSlug: detail.slug,
        name: detail.name,
        size: variant.size,
        color: detail.color,
        unitPrice: displayPrice(detail),
        imageUrl: detail.imageUrl,
        includeDupatta: detail.dupattaPrice != null,
        includeJacket: detail.jacketPrice != null,
        dupattaPrice: detail.dupattaPrice,
        jacketPrice: detail.jacketPrice,
        measurements: '',
      });
      showToast('Added to your bag');
      openDrawer();
    } catch {
      navigate(`/product/${p.slug}`);
    }
  };

  return (
    <div className="page-home">
      <Nav home />

      {/* HERO */}
      <header className="hero">
        {/* `label` is the empty-state caption (an instruction to the boutique);
            `alt` is what a visitor's screen reader hears once a photo exists. */}
        <ImageSlot
          src={site.hero.imageUrl}
          label="Drop campaign image — full bleed editorial"
          alt={site.hero.title}
          focusX={site.hero.focusX}
          focusY={site.hero.focusY}
        />
        <div className="veil"></div>
        <div className="side-label">{site.hero.seasonLabel}</div>
        <div className="hero-inner">
          <span className="eyebrow">{site.hero.eyebrow}</span>
          <h1>
            {site.hero.title}
            <span className="ital">{site.hero.titleItalic}</span>
          </h1>
          <div className="actions">
            <Link className="btn-buy" to="/collection">
              {site.hero.ctaPrimary}
            </Link>
            <Link className="btn-outline" to="/contact">
              {site.hero.ctaSecondary}
            </Link>
          </div>
        </div>
        <div className="hero-edge">
          <span>{site.hero.edgeLeft}</span>
          <span>{site.hero.edgeRight}</span>
        </div>
      </header>

      {/* WARDROBE / CATEGORIES */}
      <section className="wardrobe" id="cats" style={{ paddingTop: 'var(--section-y)' }}>
        <div className="head-center">
          <span className="eyebrow">The Wardrobe</span>
          <h2>Shop by category</h2>
        </div>
        <div className="cats">
          {cats.map((c) => (
            <Link className="cat" key={c.slug} to={`/collection/${c.slug}`}>
              <ImageSlot label={c.name} />
              <div className="cap">
                <span className="name">{c.name}</span>
                <span className="go">Explore →</span>
              </div>
            </Link>
          ))}
        </div>
      </section>

      {/* MARQUEE */}
      <div className="marquee" aria-hidden="true">
        {/* The track prints the list twice so the loop is seamless; every
            second line is set in italics, as the reference marquee does.
            Parity runs over the position *within one copy*, so an odd number
            of lines can't italicise the second half opposite the first. */}
        <div className="marquee-track">
          {[...marquee, ...marquee].map((t, i) => (
            <span key={i} className={(i % marquee.length) % 2 === 1 ? 'it' : undefined}>
              {t}
            </span>
          ))}
        </div>
      </div>

      {/* FEATURED */}
      <section id="feature" className="feature">
        <div className="feat-grid">
          <ImageSlot
            src={site.featured.imageUrl}
            label="Featured collection — editorial portrait"
            alt={site.featured.title}
            focusX={site.featured.focusX}
            focusY={site.featured.focusY}
          />
          <div className="feat-text">
            <span className="eyebrow">{site.featured.eyebrow}</span>
            <h2>
              {site.featured.title} <em>{site.featured.titleEm}</em>
            </h2>
            <p>{site.featured.copy}</p>
            <Link className="btn btn-line" to={site.featured.ctaHref}>
              {site.featured.ctaLabel} <span>→</span>
            </Link>
          </div>
        </div>
      </section>

      {/* BESTSELLERS */}
      <section id="best" className="best">
        <div className="head-center">
          <span className="eyebrow">Most Loved</span>
          <h2>Bestsellers</h2>
          <p>The pieces our clients return for — quietly extraordinary, endlessly re-wearable.</p>
        </div>
        {best.length > 0 ? (
          <div className="products">
            {best.map((p) => (
              <div className="product" key={p.id}>
                <Link to={`/product/${p.slug}`}>
                  <ImageSlot src={p.imageUrl} label={p.name} alt={p.name} />
                </Link>
                <div className="meta">
                  <div className="pname">{p.name}</div>
                  <div className="price">
                    <Price paise={p.price} />
                  </div>
                  <div className="add">
                    <span className="quick" onClick={() => void quickAdd(p)}>
                      Add to Bag
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        ) : (
          <p className="api-note">The bestsellers are being prepared — please check back shortly.</p>
        )}
      </section>

      {/* LOOKBOOK COVER */}
      <section id="look" className="look">
        <ImageSlot
          src={site.lookbookCover.imageUrl}
          label="Lookbook cover — full bleed"
          alt={site.lookbookCover.masthead}
          focusX={site.lookbookCover.focusX}
          focusY={site.lookbookCover.focusY}
        />
        <div className="look-cover">
          <div className="masthead">{site.lookbookCover.masthead}</div>
          <div className="sub">
            {site.lookbookCover.subItems.map((s, i) => (
              <Fragment key={i}>
                {i > 0 && <span>·</span>}
                <span>{s}</span>
              </Fragment>
            ))}
          </div>
          <Link className="btn-outline" to="/lookbook">
            View the Lookbook
          </Link>
        </div>
      </section>

      {/* TRUST */}
      <section className="trust" style={{ padding: 0 }}>
        {site.trust.items.map((t, i) => (
          <div className="item" key={i}>
            <div className="t">{t.title}</div>
            <div className="d">{t.detail}</div>
          </div>
        ))}
      </section>

      {/* NEWSLETTER */}
      <NewsletterSection />

      <Footer mark />
      <Reveal watch={best.length + cats.length} />
      <Ambient watch={best.length} />
    </div>
  );
}

function NewsletterSection() {
  const [done, setDone] = useState(false);
  const [email, setEmail] = useState('');
  return (
    <section className="news">
      <span className="eyebrow">The Letter</span>
      <h2>Join the atelier</h2>
      <p>Private previews, made-to-order openings and the occasional letter from the studio.</p>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          track('newsletter_signup');
          setEmail('');
          setDone(true);
        }}
      >
        <input
          type="email"
          placeholder="Your email address"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <button type="submit">{done ? 'Thank you' : 'Subscribe'}</button>
      </form>
    </section>
  );
}
