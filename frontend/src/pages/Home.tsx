import { Fragment, useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useLiveCategories } from '../lib/categories';
import { MARQUEE_MIN_CHARS, fillTrack, useSiteContent } from '../lib/content';
import type { ProductSummary, ProductsResponse } from '../lib/types';
import { track } from '../lib/analytics';
import Nav from '../components/Nav';
import Ticker from '../components/Ticker';
import Footer from '../components/Footer';
import ImageSlot from '../components/ImageSlot';
import Price from '../components/Price';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/home.css';
import { usePageTitle } from '../lib/usePageTitle';

export default function Home() {
  usePageTitle('');
  // Only categories with pieces — an empty door is worse than a shorter row.
  const cats = useLiveCategories().slice(0, 4);
  const [best, setBest] = useState<ProductSummary[]>([]);
  const site = useSiteContent();
  // One copy of the marquee has to span the strip before it can be doubled into
  // a seamless loop — a one- or two-line marquee is repeated up to the length
  // the band was drawn for.
  const marquee = fillTrack(site.marquee.items, MARQUEE_MIN_CHARS);
  useEffect(() => {
    let cancelled = false;
    api
      .get<ProductsResponse>('/api/products?sort=featured&page=1&limit=5')
      .then((data) => {
        if (!cancelled) setBest(data.items.slice(0, 5));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <div className="page-home">
      {/* The announcement bar runs on every page — the homepage was the one
          place it went missing (audit §02). */}
      <Ticker />
      <Nav home />

      {/* HERO */}
      <header className="hero">
        {/* `label` is the empty-state caption (an instruction to the boutique);
            `alt` is what a visitor's screen reader hears once a photo exists.
            Eager: the hero IS the landing paint — lazy would delay the LCP.
            CMS images carry no dims, so no srcset — eager + 100vw still helps. */}
        <ImageSlot
          src={site.hero.imageUrl}
          label="Drop campaign image — full bleed editorial"
          alt={site.hero.title}
          focusX={site.hero.focusX}
          focusY={site.hero.focusY}
          sizes="100vw"
          eager
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

      {/* WARDROBE / CATEGORIES — hidden entirely until at least one category
          has pieces in it. */}
      {cats.length > 0 && (
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
      )}

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

      {/* THE FIRST FIVE — a new house cannot have bestsellers, and customers
          can smell an invented one. Honest, and it turns newness into an
          invitation (audit §04). */}
      <section id="best" className="best">
        <div className="head-center">
          <span className="eyebrow">Where to Begin</span>
          <h2>The first five</h2>
          <p>Where most women begin with us.</p>
        </div>
        {best.length > 0 ? (
          <div className="products">
            {best.map((p) => (
              <div className="product" key={p.id}>
                <Link to={`/product/${p.slug}`}>
                  <ImageSlot
                    src={p.imageUrl}
                    label={p.name}
                    alt={p.name}
                    width={p.imageWidth}
                    height={p.imageHeight}
                    placeholderHex={p.imageColorHex || undefined}
                    sizes="(max-width: 560px) 50vw, 20vw"
                  />
                </Link>
                <div className="meta">
                  <div className="pname">{p.name}</div>
                  <div className="price">
                    <Price paise={p.price} />
                  </div>
                  <div className="add">
                    {/* No quick-add: a couture piece deserves its page (size,
                        colour, MTM) — and a bare span invited accidental taps. */}
                    <Link className="quick" to={`/product/${p.slug}`}>
                      View the Piece
                    </Link>
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
