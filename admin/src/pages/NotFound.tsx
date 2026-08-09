import { Link, useLocation } from 'react-router-dom';

/**
 * Unknown URLs used to bounce silently to the Dashboard, which made a typo or
 * a stale bookmark look like it had worked. Saying so is kinder.
 */
export default function NotFound() {
  const location = useLocation();
  return (
    <div className="login-wrap">
      <div className="login-card">
        <span className="eyebrow">Atelier Admin</span>
        <h1>Page not found</h1>
        <p className="state-note">
          Nothing lives at <code>{location.pathname}</code> — the address may be mistyped, or the
          page may have moved.
        </p>
        <p className="state-note">
          <Link className="ulink" to="/">
            ← Back to the Dashboard
          </Link>
        </p>
      </div>
    </div>
  );
}
