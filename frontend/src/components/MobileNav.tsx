import { useEffect } from 'react';
import { Link } from 'react-router-dom';
import { useSiteContent } from '../lib/content';
import BrandLogo from './BrandLogo';

// The same canonical set as the desktop nav (plus Client Care, which desktop
// carries in the footer) — one nav, every page, every width.
const LINKS = [
  { t: 'The Collection', h: '/collection' },
  { t: 'Lookbook', h: '/lookbook' },
  { t: 'Archive', h: '/archive' },
  { t: 'The House', h: '/the-house' },
  { t: 'Client Care', h: '/client-care' },
];
const SUB = [
  { t: 'Search', h: '/search' },
  { t: 'My Account', h: '/account' },
  { t: 'Wishlist', h: '/wishlist' },
  { t: 'Your Bag', h: '/cart' },
];

/** Full-screen forest overlay menu (replicates mobile-nav.js). */
export default function MobileNav({
  open,
  onClose,
  onSearch,
}: {
  open: boolean;
  onClose: () => void;
  /** Opens the inline nav search bar instead of navigating to /search. */
  onSearch?: () => void;
}) {
  const { footer } = useSiteContent();
  const socials = [
    { t: 'Instagram', url: footer.instagramUrl },
    { t: 'Pinterest', url: footer.pinterestUrl },
    { t: 'WhatsApp', url: footer.whatsappUrl },
  ].filter((s) => s.url);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onResize = () => {
      if (window.innerWidth > 820) onClose();
    };
    document.addEventListener('keydown', onKey);
    window.addEventListener('resize', onResize);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      window.removeEventListener('resize', onResize);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return (
    <div className={`mnav-overlay${open ? ' open' : ''}`} aria-hidden={!open}>
      <div className="mnav-head">
        <span className="b">
          <BrandLogo />
          Tanvi Agnihotry
        </span>
        <button className="c" aria-label="Close menu" onClick={onClose}>
          ✕
        </button>
      </div>
      <div className="mnav-body">
        <nav className="mnav-links">
          {LINKS.map((l) => (
            <Link key={l.t} to={l.h} onClick={onClose}>
              {l.t}
              <span className="ar">→</span>
            </Link>
          ))}
        </nav>
        <div className="mnav-sub">
          {SUB.map((l) =>
            l.t === 'Search' ? (
              // Opens the inline nav bar; /search stays the no-JS fallback.
              <a
                key={l.t}
                href={l.h}
                onClick={(e) => {
                  if (onSearch) {
                    e.preventDefault();
                    onSearch();
                  }
                }}
              >
                {l.t}
              </a>
            ) : (
              <Link key={l.t} to={l.h} onClick={onClose}>
                {l.t}
              </Link>
            ),
          )}
        </div>
        {socials.length > 0 && (
          <div className="mnav-social">
            {socials.map((s) => (
              <a key={s.t} href={s.url} target="_blank" rel="noreferrer">
                {s.t}
              </a>
            ))}
          </div>
        )}
      </div>
      <div className="mnav-foot">
        <Link to="/contact" onClick={onClose}>
          Book an Appointment
        </Link>
      </div>
    </div>
  );
}
