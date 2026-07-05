import { Link } from 'react-router-dom';

interface FooterProps {
  /** Homepage variant: giant centered Bodoni wordmark above the columns. */
  mark?: boolean;
}

export default function Footer({ mark = false }: FooterProps) {
  return (
    <footer className="foot" style={mark ? { marginTop: 0 } : undefined}>
      {mark && <div className="foot-mark">Tanvi Agnihotry</div>}
      <div className="foot-top">
        <div className="foot-brand">
          {!mark && (
            <Link className="wordmark" to="/">
              Tanvi Agnihotry
            </Link>
          )}
          <p>
            Indo-western couture, made to order in India. Crafting timeless pieces for the modern
            Indian woman since 2026.
          </p>
        </div>
        <div className="foot-col">
          <h5>Shop</h5>
          <Link to="/collection/lehenga-sets">Lehenga Sets</Link>
          <Link to="/collection/jacket-sets">Jacket Sets</Link>
          <Link to="/collection/gowns">Gowns</Link>
          <Link to="/collection/anarkali">Anarkali</Link>
        </div>
        <div className="foot-col">
          <h5>The House</h5>
          <Link to="/the-house">Our Story</Link>
          {mark ? <Link to="/lookbook">Lookbook</Link> : <Link to="/the-house">Artisanship</Link>}
          <Link to="/contact">Made to Order</Link>
          {mark ? <Link to="/client-care">Client Care</Link> : <Link to="/client-care">Press</Link>}
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
          <a href="#">Instagram</a>
          <a href="#">Pinterest</a>
          <a href="#">WhatsApp</a>
        </div>
      </div>
    </footer>
  );
}
