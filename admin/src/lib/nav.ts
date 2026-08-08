import { matchPath } from 'react-router-dom';

export interface NavItem {
  to: string;
  label: string;
  end?: boolean;
}

export interface NavSection {
  title: string;
  items: NavItem[];
}

/** The two capture flows — prominent action buttons at the top of the sidebar, and the ⊕ sheet on phones. */
export const CAPTURE_ACTIONS: NavItem[] = [
  { to: '/orders/new', label: 'New Order' },
  { to: '/intake', label: 'Scan Bill' },
];

/** Desktop sidebar, grouped. */
export const NAV_SECTIONS: NavSection[] = [
  { title: 'Overview', items: [{ to: '/', label: 'Dashboard', end: true }] },
  {
    title: 'Sell',
    items: [
      { to: '/orders', label: 'Orders', end: true },
      { to: '/deliveries', label: 'Deliveries' },
      { to: '/payments', label: 'Payments' },
    ],
  },
  { title: 'Catalog', items: [{ to: '/products', label: 'Products' }] },
  { title: 'People', items: [{ to: '/users', label: 'Customers' }] },
  {
    title: 'Insights',
    items: [
      { to: '/analytics', label: 'Analytics' },
      { to: '/socials', label: 'Socials' },
    ],
  },
];

/** Destinations that live behind the phone "More" sheet (everything not on the tab bar). */
export const MORE_ITEMS: NavItem[] = [
  { to: '/products', label: 'Products' },
  { to: '/payments', label: 'Payments' },
  { to: '/users', label: 'Customers' },
  { to: '/socials', label: 'Socials' },
  { to: '/analytics', label: 'Analytics' },
];

interface RouteMeta {
  pattern: string;
  title: string;
  eyebrow: string;
  /** Detail routes get a back chevron in the phone app bar. */
  backTo?: string;
}

const ROUTE_META: RouteMeta[] = [
  { pattern: '/', title: 'Dashboard', eyebrow: 'Atelier' },
  { pattern: '/deliveries', title: 'Deliveries', eyebrow: 'Production' },
  { pattern: '/intake', title: 'Scan Bill', eyebrow: 'The Order Book' },
  { pattern: '/products', title: 'Products', eyebrow: 'Catalog' },
  { pattern: '/products/new', title: 'New Piece', eyebrow: 'Catalog', backTo: '/products' },
  { pattern: '/products/:id', title: 'Edit Piece', eyebrow: 'Catalog', backTo: '/products' },
  { pattern: '/orders', title: 'Orders', eyebrow: 'The Order Book' },
  { pattern: '/orders/new', title: 'New Order', eyebrow: 'The Order Book', backTo: '/orders' },
  { pattern: '/orders/:id', title: 'Order', eyebrow: 'The Order Book', backTo: '/orders' },
  { pattern: '/payments', title: 'Payments', eyebrow: 'Ledger' },
  { pattern: '/users', title: 'Customers', eyebrow: 'People' },
  { pattern: '/socials', title: 'Socials', eyebrow: 'Reach' },
  { pattern: '/analytics', title: 'Analytics', eyebrow: 'Insights' },
];

export function routeMeta(pathname: string): RouteMeta | null {
  for (const meta of ROUTE_META) {
    if (matchPath({ path: meta.pattern, end: true }, pathname)) return meta;
  }
  return null;
}
