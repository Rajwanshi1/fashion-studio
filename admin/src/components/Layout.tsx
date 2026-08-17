import { NavLink, Outlet, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import BrandLogo from './BrandLogo';

const navClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'on' : '');

export default function Layout() {
  const { user, logout } = useAuth();
  const navigate = useNavigate();

  const signOut = () => {
    logout();
    navigate('/login', { replace: true });
  };

  return (
    <div className="admin">
      <aside className="side">
        <div className="brand">
          <NavLink to="/" className="wordmark">
            <BrandLogo />
            Tanvi Agnihotry
          </NavLink>
          <span className="atelier">· Atelier ·</span>
        </div>
        <nav aria-label="Admin">
          <NavLink to="/" end className={navClass}>
            Dashboard
          </NavLink>
          <NavLink to="/deliveries" className={navClass}>
            Deliveries
          </NavLink>
          <NavLink to="/intake" className={navClass}>
            Scan Bill
          </NavLink>
          <NavLink to="/products" className={navClass}>
            Products
          </NavLink>
          <NavLink to="/site" className={navClass}>
            Site
          </NavLink>
          <NavLink to="/orders" end className={navClass}>
            Orders
          </NavLink>
          <NavLink to="/orders/new" className={navClass}>
            New Order
          </NavLink>
          <NavLink to="/payments" className={navClass}>
            Payments
          </NavLink>
          <NavLink to="/users" className={navClass}>
            Users
          </NavLink>
          <NavLink to="/socials" className={navClass}>
            Socials
          </NavLink>
          <NavLink to="/analytics" className={navClass}>
            Analytics
          </NavLink>
          <NavLink to="/sessions" className={navClass}>
            Sessions
          </NavLink>
        </nav>
        <div className="side-foot">
          {user && (
            <span className="who">
              {user.firstName} {user.lastName}
            </span>
          )}
          <button type="button" className="signout" onClick={signOut}>
            Sign Out
          </button>
        </div>
      </aside>
      <main className="canvas">
        <Outlet />
      </main>
    </div>
  );
}
