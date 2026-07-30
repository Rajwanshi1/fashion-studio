import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
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
      cart.add({
        variantId: variant.id,
        productId: detail.id,
        productSlug: detail.slug,
        name: detail.name,
        size: variant.size,
        color: detail.color,
        unitPrice: detail.price,
        imageUrl: detail.imageUrl,
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
        <ImageSlot label="Drop campaign image — full bleed editorial" />
        <div className="veil"></div>
        <div className="side-label">Spring / Summer 2026</div>
        <div className="hero-inner">
          <span className="eyebrow">The Verdant Edit · Indo-Western Couture</span>
          <h1>
            Tanvi Agnihotry<span className="ital">heritage, made to move.</span>
          </h1>
          <div className="actions">
            <Link className="btn-buy" to="/collection/lehenga">
              Discover the Collection
            </Link>
            <Link className="btn-outline" to="/contact">
              Book an Appointment
            </Link>
          </div>
        </div>
        <div className="hero-edge">
          <span>Made to Order — India</span>
          <span>Vol. 01 / 24 Looks</span>
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
        <div className="marquee-track">
          <span>Made to Order</span>
          <span className="it">— hand embroidered —</span>
          <span>The Verdant Edit</span>
          <span className="it">— Spring 2026 —</span>
          <span>Made to Order</span>
          <span className="it">— hand embroidered —</span>
          <span>The Verdant Edit</span>
          <span className="it">— Spring 2026 —</span>
        </div>
      </div>

      {/* FEATURED */}
      <section id="feature" className="feature">
        <div className="feat-grid">
          <ImageSlot label="Featured collection — editorial portrait" />
          <div className="feat-text">
            <span className="eyebrow">The New Collection</span>
            <h2>
              Rang <em>Mehfil</em>
            </h2>
            <p>
              Hand-embroidered indo-western silhouettes in moss, sage and pistachio — cut for the
              way the modern Indian woman actually moves. Each piece made to order, each made to
              last.
            </p>
            <Link className="btn btn-line" to="/collection/lehenga">
              Explore the Edit <span>→</span>
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
        <ImageSlot label="Lookbook cover — full bleed" />
        <div className="look-cover">
          <div className="masthead">The Edit</div>
          <div className="sub">
            <span>Volume 01</span>
            <span>·</span>
            <span>Spring 2026</span>
            <span>·</span>
            <span>32 Looks</span>
          </div>
          <Link className="btn-outline" to="/lookbook">
            View the Lookbook
          </Link>
        </div>
      </section>

      {/* TRUST */}
      <section className="trust" style={{ padding: 0 }}>
        <div className="item">
          <div className="t">Made to Order</div>
          <div className="d">Crafted on commission · 4–6 weeks</div>
        </div>
        <div className="item">
          <div className="t">Complimentary Fittings</div>
          <div className="d">Virtual or in-studio, Mumbai</div>
        </div>
        <div className="item">
          <div className="t">Worldwide Shipping</div>
          <div className="d">Insured &amp; tracked, on the house</div>
        </div>
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
