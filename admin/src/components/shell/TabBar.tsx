import { NavLink, useLocation } from 'react-router-dom';
import { MORE_ITEMS } from '../../lib/nav';
import { DeliveriesIcon, HomeIcon, MoreIcon, OrdersIcon } from './icons';

interface TabBarProps {
  onCapture: () => void;
  onMore: () => void;
}

const tabClass = ({ isActive }: { isActive: boolean }) => (isActive ? 'tab on' : 'tab');

/** Phone bottom navigation: the daily destinations plus the center ⊕ capture button. */
export default function TabBar({ onCapture, onMore }: TabBarProps) {
  const { pathname } = useLocation();
  const moreActive = MORE_ITEMS.some(
    (item) => pathname === item.to || pathname.startsWith(`${item.to}/`),
  );
  return (
    <nav className="tabbar" aria-label="Primary">
      <NavLink to="/" end className={tabClass}>
        <HomeIcon />
        <span>Home</span>
      </NavLink>
      <NavLink to="/orders" className={tabClass}>
        <OrdersIcon />
        <span>Orders</span>
      </NavLink>
      <div className="tab-plus-wrap">
        <button
          type="button"
          className="tab-plus"
          aria-label="New order or scan bill"
          onClick={onCapture}
        >
          +
        </button>
      </div>
      <NavLink to="/deliveries" className={tabClass}>
        <DeliveriesIcon />
        <span>Deliveries</span>
      </NavLink>
      <button type="button" className={moreActive ? 'tab on' : 'tab'} onClick={onMore}>
        <MoreIcon />
        <span>More</span>
      </button>
    </nav>
  );
}
