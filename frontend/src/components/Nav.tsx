import { useEffect, useState, type MouseEvent } from 'react';
import { Link } from 'react-router-dom';
import { useCart } from '../lib/cart';
import { useCartDrawer } from './CartDrawer';
import MobileNav from './MobileNav';
import NavSearch from './NavSearch';
import BrandLogo from './BrandLogo';
import SearchIcon from './SearchIcon';

interface NavProps {
  /** Homepage variant: fixed + transparent over hero, turns solid past 60px. */
  home?: boolean;
}

export default function Nav({ home = false }: NavProps) {
  const { count } = useCart();
  const { openDrawer } = useCartDrawer();
  const [menuOpen, setMenuOpen] = useState(false);
  const [searchOpen, setSearchOpen] = useState(false);
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
              <Link to="/collection">Women</Link>
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
          {/* Intercepted like the Bag link: opens the inline bar, /search is
              the no-JS fallback. Opens only — an outside-mousedown close would
              race a toggle. */}
          <a
            href="/search"
            aria-expanded={searchOpen}
            onClick={(e) => {
              e.preventDefault();
              setSearchOpen(true);
            }}
          >
            Search
          </a>
          <Link to="/account">Account</Link>
          {/* Before the bag anchor so Bag stays a:last-child for mobile-nav.css. */}
          <button className="nav-search-toggle" aria-label="Search" onClick={() => setSearchOpen(true)}>
            <SearchIcon size={18} />
          </button>
          <a className="bag" href="/cart" onClick={onBagClick}>
            Bag <span className="count">({count})</span>
          </a>
        </div>
        {searchOpen && <NavSearch onClose={() => setSearchOpen(false)} />}
      </nav>
      <MobileNav
        open={menuOpen}
        onClose={() => setMenuOpen(false)}
        onSearch={() => {
          setMenuOpen(false);
          setSearchOpen(true);
        }}
      />
    </>
  );
}
