/**
 * Storefront sections, MIRRORED as props-only previews.
 *
 * Each component copies its storefront markup class-for-class so the mirrored
 * CSS (storefront.css) renders it identically — when the storefront's JSX
 * changes, re-copy it here (each mirror names its source). Differences are
 * deliberate and uniform: no router/context/state (content arrives as props),
 * and links render as bare href-less <a> so nothing inside a preview can
 * navigate or take focus (storefront.css's preview tail kills their pointer
 * events too).
 */
import { Fragment } from 'react';
import { SECTION_DEFAULTS } from '../lib/siteContent';
import type {
  FeaturedContent,
  FooterContent,
  HeroContent,
  LookContent,
  LookbookContent,
  LookbookCoverContent,
  TrustItemContent,
} from '../lib/siteContent';

/* ---- MIRROR of frontend/src/components/ImageSlot.tsx (+ focal point) ---- */

interface PreviewImageProps {
  src?: string | null;
  alt?: string;
  label?: string;
  className?: string;
  focusX?: number;
  focusY?: number;
}

export function PreviewImage({
  src, alt = '', label = '', className = '', focusX, focusY,
}: PreviewImageProps) {
  const cls = className ? `img-slot ${className}` : 'img-slot';
  if (src) {
    const style = focusX !== undefined || focusY !== undefined
      ? { objectPosition: `${focusX ?? 50}% ${focusY ?? 50}%` }
      : undefined;
    // lazy/async is a deliberate divergence from the storefront's ImageSlot:
    // the canvas mounts ~11 full-resolution originals, nearly all below the
    // fold, to paint scaled-down previews.
    return (
      <img className={cls} src={src} alt={alt || label} style={style} loading="lazy" decoding="async" />
    );
  }
  return (
    <div className={cls} role="img" aria-label={alt || label}>
      <span>{label}</span>
    </div>
  );
}

/* ---- MIRROR of frontend/src/lib/content.tsx fillTrack + MIN_CHARS ---- */

/** Repeat a short list until one copy of the track spans its band. */
export function fillTrack(items: string[], minChars: number): string[] {
  const chars = items.join('').length;
  if (chars === 0) return [...items];
  const copies = Math.max(1, Math.ceil(minChars / chars));
  return Array.from({ length: copies }, () => items).flat();
}

export const MARQUEE_MIN_CHARS = SECTION_DEFAULTS.marquee.items.join('').length;
export const TICKER_MIN_CHARS = SECTION_DEFAULTS.ticker.items.join('').length;

/* ---- MIRROR of frontend/src/pages/Home.tsx — HERO ---- */

export function HeroPreview({ hero }: { hero: HeroContent }) {
  return (
    <header className="hero">
      <PreviewImage
        src={hero.imageUrl}
        label="Drop campaign image — full bleed editorial"
        alt={hero.title}
        focusX={hero.focusX}
        focusY={hero.focusY}
      />
      <div className="veil"></div>
      <div className="side-label">{hero.seasonLabel}</div>
      <div className="hero-inner">
        <span className="eyebrow">{hero.eyebrow}</span>
        <h1>
          {hero.title}
          <span className="ital">{hero.titleItalic}</span>
        </h1>
        <div className="actions">
          <a className="btn-buy">{hero.ctaPrimary}</a>
          <a className="btn-outline">{hero.ctaSecondary}</a>
        </div>
      </div>
      <div className="hero-edge">
        <span>{hero.edgeLeft}</span>
        <span>{hero.edgeRight}</span>
      </div>
    </header>
  );
}

/* ---- MIRROR of frontend/src/pages/Home.tsx — MARQUEE ---- */

export function MarqueePreview({ items }: { items: string[] }) {
  const marquee = fillTrack(items, MARQUEE_MIN_CHARS);
  return (
    <div className="marquee" aria-hidden="true">
      {/* doubled track, italics by position within one copy */}
      <div className="marquee-track">
        {[...marquee, ...marquee].map((t, i) => (
          <span key={i} className={(i % marquee.length) % 2 === 1 ? 'it' : undefined}>
            {t}
          </span>
        ))}
      </div>
    </div>
  );
}

/* ---- MIRROR of frontend/src/pages/Home.tsx — FEATURED ---- */

export function FeaturedPreview({ featured }: { featured: FeaturedContent }) {
  return (
    <section className="feature">
      <div className="feat-grid">
        <PreviewImage
          src={featured.imageUrl}
          label="Featured collection — editorial portrait"
          alt={featured.title}
          focusX={featured.focusX}
          focusY={featured.focusY}
        />
        <div className="feat-text">
          <span className="eyebrow">{featured.eyebrow}</span>
          <h2>
            {featured.title} <em>{featured.titleEm}</em>
          </h2>
          <p>{featured.copy}</p>
          <a className="btn btn-line">
            {featured.ctaLabel} <span>→</span>
          </a>
        </div>
      </div>
    </section>
  );
}

/* ---- MIRROR of frontend/src/pages/Home.tsx — LOOKBOOK COVER ---- */

export function LookbookCoverHomePreview({ lookbookCover }: { lookbookCover: LookbookCoverContent }) {
  return (
    <section className="look">
      <PreviewImage
        src={lookbookCover.imageUrl}
        label="Lookbook cover — full bleed"
        alt={lookbookCover.masthead}
        focusX={lookbookCover.focusX}
        focusY={lookbookCover.focusY}
      />
      <div className="look-cover">
        <div className="masthead">{lookbookCover.masthead}</div>
        <div className="sub">
          {lookbookCover.subItems.map((s, i) => (
            <Fragment key={i}>
              {i > 0 && <span>·</span>}
              <span>{s}</span>
            </Fragment>
          ))}
        </div>
        <a className="btn-outline">View the Lookbook</a>
      </div>
    </section>
  );
}

/* ---- MIRROR of frontend/src/pages/Home.tsx — TRUST ---- */

export function TrustPreview({ items }: { items: TrustItemContent[] }) {
  return (
    <section className="trust" style={{ padding: 0 }}>
      {items.map((t, i) => (
        <div className="item" key={i}>
          <div className="t">{t.title}</div>
          <div className="d">{t.detail}</div>
        </div>
      ))}
    </section>
  );
}

/* ---- MIRROR of frontend/src/components/Ticker.tsx ---- */

export function TickerPreview({ items }: { items: string[] }) {
  const copy = fillTrack(items, TICKER_MIN_CHARS).flatMap((t) => [t, '·']);
  return (
    <div className="ticker">
      <div className="ticker-track">
        {copy.map((t, i) => (
          <span key={`a${i}`}>{t}</span>
        ))}
        {copy.map((t, i) => (
          <span key={`b${i}`}>{t}</span>
        ))}
      </div>
    </div>
  );
}

/* ---- MIRROR of frontend/src/components/Footer.tsx (mark variant, as on Home) ---- */

export function FooterPreview({ footer }: { footer: FooterContent }) {
  return (
    <footer className="foot" style={{ marginTop: 0 }}>
      <div className="foot-mark">Tanvi Agnihotry</div>
      <div className="foot-top">
        <div className="foot-brand">
          <p>{footer.blurb}</p>
        </div>
        <div className="foot-col">
          <h5>Shop</h5>
          <a>Lehenga</a>
          <a>Anarkali</a>
          <a>Suits</a>
          <a>Kaftan</a>
          <a>Antifit</a>
        </div>
        <div className="foot-col">
          <h5>The House</h5>
          <a>Our Story</a>
          <a>Lookbook</a>
          <a>Made to Order</a>
          <a>Client Care</a>
        </div>
        <div className="foot-col">
          <h5>Client Care</h5>
          <a>Book an Appointment</a>
          <a>Size &amp; Fit</a>
          <a>Shipping</a>
          <a>Contact</a>
        </div>
      </div>
      <div className="foot-bottom">
        <span>© 2026 Tanvi Agnihotry</span>
        <div className="socials">
          {/* Mirror of the storefront rule: no URL, no link. */}
          {footer.instagramUrl && <a>Instagram</a>}
          {footer.pinterestUrl && <a>Pinterest</a>}
          {footer.whatsappUrl && <a>WhatsApp</a>}
        </div>
      </div>
    </footer>
  );
}

/* ---- MIRROR of frontend/src/pages/Lookbook.tsx — cover + spreads + quote ---- */

function CaptionPreview({ look }: { look: LookContent }) {
  return (
    <div className="caption">
      <span className="look-no">{look.lookNo}</span>
      <h3>{look.title}</h3>
      <p>{look.copy}</p>
      <a className="shop-look">Shop the Look →</a>
    </div>
  );
}

function LookSlotPreview({
  look,
  label,
  className,
}: {
  look: LookContent;
  label: string;
  className: string;
}) {
  return (
    <PreviewImage
      className={className}
      src={look.imageUrl}
      label={label}
      alt={look.title || label}
      focusX={look.focusX}
      focusY={look.focusY}
    />
  );
}

export function LookbookPreview({
  lookbookCover,
  lookbook,
}: {
  lookbookCover: LookbookCoverContent;
  lookbook: LookbookContent;
}) {
  const looks = lookbook.looks;
  return (
    <>
      <header className="lb-cover">
        <PreviewImage
          src={lookbookCover.imageUrl}
          label="Lookbook cover — full bleed editorial"
          alt={lookbookCover.masthead}
          focusX={lookbookCover.focusX}
          focusY={lookbookCover.focusY}
        />
        <div className="cc">
          <div className="masthead">{lookbookCover.masthead}</div>
          <div className="sub">
            {lookbookCover.subItems.map((item, i) => (
              <Fragment key={i}>
                {i > 0 && <span>·</span>}
                <span>{item}</span>
              </Fragment>
            ))}
          </div>
        </div>
        <div className="scroll">Scroll to enter ↓</div>
      </header>

      <main className="lb">
        <section className="spread text-left">
          <CaptionPreview look={looks[0]} />
          <LookSlotPreview className="ar54" look={looks[0]} label="Look 01 — wide" />
        </section>

        <section className="spread duo">
          <LookSlotPreview className="ar34" look={looks[1]} label="Look 02" />
          <LookSlotPreview className="ar34" look={looks[2]} label="Look 03" />
        </section>

        {/* the pull-quote sits mid-page, between the first duo and Look 04 */}
        <div className="pull">
          <blockquote>{lookbook.quote}</blockquote>
          <cite>{lookbook.quoteCite}</cite>
        </div>

        <section className="spread offset">
          <LookSlotPreview className="ar45" look={looks[3]} label="Look 04 — large" />
          <CaptionPreview look={looks[3]} />
        </section>

        <section className="spread duo">
          <LookSlotPreview className="ar34" look={looks[4]} label="Look 05" />
          <LookSlotPreview className="ar34" look={looks[5]} label="Look 06" />
        </section>

        <section className="spread">
          <LookSlotPreview className="ar54" look={looks[6]} label="Look 07 — full bleed" />
        </section>
      </main>
    </>
  );
}
