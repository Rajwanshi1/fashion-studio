import { Link } from 'react-router-dom';
import BrandLogo from '../components/BrandLogo';
import '../styles/notfound.css';

export default function NotFound() {
  return (
    <div className="page-nf">
      <div className="nf-brand">
        <Link to="/">
          <BrandLogo />
          Tanvi Agnihotry
        </Link>
      </div>
      <main className="nf">
        <div className="ghost">404</div>
        <div className="inner">
          <span className="eyebrow">Page Not Found</span>
          <h1>This thread seems to have come loose.</h1>
          <p>
            The page you're looking for has moved or never existed. Let us guide you back to
            something beautiful.
          </p>
          <div className="actions">
            <Link className="btn-buy gold" to="/">
              Return Home
            </Link>
            <Link className="btn-outline" to="/collection/lehenga">
              Explore the Collection
            </Link>
          </div>
          <div className="links">
            <Link to="/collections">Collections</Link>
            <Link to="/lookbook">Lookbook</Link>
            <Link to="/the-house">The House</Link>
            <Link to="/contact">Contact</Link>
          </div>
        </div>
      </main>
    </div>
  );
}
