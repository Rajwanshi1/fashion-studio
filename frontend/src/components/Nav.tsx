import { useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { useCartDrawer } from './CartDrawer';
import MobileNav from './MobileNav';
import BrandLogo from './BrandLogo';

interface NavProps {
  /** Homepage variant: fixed + transparent over hero, turns solid past 60px. */
  home?: boolean;
}

export default function Nav({ home = false }: NavProps) {
  const { count } = useCart();
  const { openDrawer } = useCartDrawer();
  const [menuOpen, setMenuOpen] = useState(false);
  const [solid, setSolid] = useState(false);

  useEffect(() => {
    if (!home) return;
    const onScroll = () => setSolid(window.scrollY > 60);
    onScroll();
    window.addEventListener('scroll', onScroll, { passive: true });
    return () => window.removeEventListener('scroll', onScroll);
  }, [home]);

  const onBagClick = (e: MouseEvent) => {
    e.preventDefault();
    openDrawer();
  };

  const navClass = home ? `nav-home has-mnav${solid ? ' solid' : ''}` : 'nav has-mnav';

  return (
    <>
      <nav id={home ? 'nav' : undefined} className={navClass}>
        <button
          className={`mnav-toggle${menuOpen ? ' open' : ''}`}
          aria-label="Open menu"
          onClick={() => setMenuOpen((o) => !o)}
        >
          <span></span>
          <span></span>
          <span></span>
        </button>
        <div className="nav-links left">
          {home ? (
            <>
              <Link to="/collections">Collections</Link>
              <Link to="/lookbook">Lookbook</Link>
              <Link to="/the-house">About Us</Link>
            </>
          ) : (
            <>
              <Link to="/collection/lehenga-sets">Women</Link>
              <Link to="/collections">Collections</Link>
              <Link to="/lookbook">Lookbook</Link>
            </>
          )}
        </div>
        <div className="wordmark">
          <Link to="/">
            <BrandLogo />
            Tanvi Agnihotry
          </Link>
        </div>
        <div className="nav-links right">
          <Link to="/search">Search</Link>
          <Link to="/account">Account</Link>
          <a className="bag" href="/cart" onClick={onBagClick}>
            Bag <span className="count">({count})</span>
          </a>
        </div>
      </nav>
      <MobileNav open={menuOpen} onClose={() => setMenuOpen(false)} />
    </>
  );
}
