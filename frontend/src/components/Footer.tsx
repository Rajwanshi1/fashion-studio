import { Link } from 'react-router-dom';
import { useLiveCategories } from '../lib/categories';
import { useSiteContent } from '../lib/content';
import BrandLogo from './BrandLogo';

interface FooterProps {
  /** Homepage variant: giant centered Bodoni wordmark above the columns. */
  mark?: boolean;
}

/** A social handle. No URL, no link — a dead href="#" reads as a broken
 *  storefront, which is worse than a shorter row. */
function Social({ url, children }: { url: string; children: string }) {
  if (!url) return null;
  return (
    <a href={url} target="_blank" rel="noreferrer">
      {children}
    </a>
  );
}

export default function Footer({ mark = false }: FooterProps) {
  const { footer } = useSiteContent();
  const categories = useLiveCategories();
  return (
    <footer className="foot" style={mark ? { marginTop: 0 } : undefined}>
      {mark && <div className="foot-mark">Tanvi Agnihotry</div>}
      <div className="foot-top">
        <div className="foot-brand">
          {!mark && (
            <Link className="wordmark" to="/">
              <BrandLogo />
              Tanvi Agnihotry
            </Link>
          )}
          <p>{footer.blurb}</p>
        </div>
        {/* One column set on every page (the old mark/inner split disagreed
            with itself, audit §02). Shop lists only categories with pieces. */}
        <div className="foot-col">
          <h5>Shop</h5>
          <Link to="/collection">All Pieces</Link>
          {categories.map((c) => (
            <Link key={c.slug} to={`/collection/${c.slug}`}>
              {c.name}
            </Link>
          ))}
        </div>
        <div className="foot-col">
          <h5>The House</h5>
          <Link to="/the-house">Our Story</Link>
          <Link to="/lookbook">Lookbook</Link>
          <Link to="/archive">The Archive</Link>
          <Link to="/contact">Made to Order</Link>
          <Link to="/client-care">Client Care</Link>
        </div>
        <div className="foot-col">
          <h5>Client Care</h5>
          <Link to="/contact">Book an Appointment</Link>
          <Link to="/size-guide">Size &amp; Fit</Link>
          <Link to="/client-care">Shipping</Link>
          <Link to="/contact">Contact</Link>
        </div>
      </div>
      <div className="foot-bottom">
        <span>© 2026 Tanvi Agnihotry</span>
        <div className="socials">
          <Social url={footer.instagramUrl}>Instagram</Social>
          <Social url={footer.pinterestUrl}>Pinterest</Social>
          <Social url={footer.whatsappUrl}>WhatsApp</Social>
        </div>
      </div>
    </footer>
  );
}
