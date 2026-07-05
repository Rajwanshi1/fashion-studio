import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { vi } from 'vitest';
import { AppRoutes, Providers } from '../App';
import type { Category, Order, ProductDetail, ProductSummary } from '../lib/types';

export function renderApp(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Providers>
        <AppRoutes />
      </Providers>
    </MemoryRouter>,
  );
}

type Handler = (url: string, init?: RequestInit) => unknown | undefined;

/** Install a fetch mock. Handler returns JSON payload, or undefined → 404. */
export function mockFetch(handler: Handler) {
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const body = handler(url, init);
    if (body === undefined) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: 'Not found' }),
      } as unknown as Response;
    }
    return { ok: true, status: 200, json: async () => body } as unknown as Response;
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

/** Fetch mock that always fails at the network level (API down). */
export function mockFetchDown() {
  const fn = vi.fn(async () => {
    throw new TypeError('fetch failed');
  });
  vi.stubGlobal('fetch', fn);
  return fn;
}

export const CATEGORIES: Category[] = [
  { id: 'c1', slug: 'lehenga-sets', name: 'Lehenga Sets', description: 'Hand-embroidered indo-western lehengas.', position: 1, productCount: 24 },
  { id: 'c2', slug: 'jacket-sets', name: 'Jacket Sets', description: 'Structured jackets.', position: 2, productCount: 18 },
  { id: 'c3', slug: 'gowns', name: 'Gowns', description: 'Fluid gowns.', position: 3, productCount: 12 },
  { id: 'c4', slug: 'anarkali', name: 'Anarkali', description: 'Anarkalis.', position: 4, productCount: 15 },
];

export const P1: ProductSummary = {
  id: 'p1',
  slug: 'sage-sequin-jacket-lehenga',
  name: 'Sage Sequin Jacket Lehenga',
  price: 18400000,
  color: 'Sage',
  flag: 'bestseller',
  imageUrl: null,
  categorySlug: 'lehenga-sets',
  categoryName: 'Lehenga Sets',
};

export const P2: ProductSummary = {
  id: 'p2',
  slug: 'moss-tissue-mirror-lehenga',
  name: 'Moss Tissue Mirror Lehenga',
  price: 17200000,
  color: 'Moss',
  flag: null,
  imageUrl: null,
  categorySlug: 'lehenga-sets',
  categoryName: 'Lehenga Sets',
};

export const DETAIL1: ProductDetail = {
  ...P1,
  description: 'A hand-embroidered jacket lehenga in moss-sage tissue.',
  details: 'Moss-sage tissue with matte hand-sequin & zardozi embroidery\nDry clean only',
  active: true,
  variants: [
    { id: 'v1', productId: 'p1', size: 'S', stock: 3 },
    { id: 'v2', productId: 'p1', size: 'M', stock: 2 },
    { id: 'v3', productId: 'p1', size: 'L', stock: 0 },
  ],
  related: [P2],
};

export const ORDER: Order = {
  id: 'o1',
  orderNumber: 'TA-2026-04817',
  userId: null,
  email: 'aanya@example.com',
  phone: '+91 90000 00000',
  firstName: 'Aanya',
  lastName: 'Mehra',
  addressLine1: '12 Sea Breeze, Altamount Road',
  addressLine2: '',
  city: 'Mumbai',
  state: 'Maharashtra',
  pincode: '400026',
  country: 'India',
  deliveryMethod: 'standard',
  deliveryFee: 0,
  subtotal: 18400000,
  total: 18400000,
  status: 'pending_payment',
  createdAt: '2026-07-05T10:00:00.000Z',
  items: [
    {
      id: 'oi1',
      productId: 'p1',
      variantId: 'v1',
      productName: 'Sage Sequin Jacket Lehenga',
      size: 'S',
      color: 'Sage',
      unitPrice: 18400000,
      quantity: 1,
      imageUrl: null,
    },
  ],
};

export function seedCart() {
  localStorage.setItem(
    'ta.cart',
    JSON.stringify([
      {
        variantId: 'v1',
        productId: 'p1',
        productSlug: 'sage-sequin-jacket-lehenga',
        name: 'Sage Sequin Jacket Lehenga',
        size: 'S',
        color: 'Sage',
        unitPrice: 18400000,
        qty: 1,
        imageUrl: null,
      },
    ]),
  );
}
