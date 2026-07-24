import { render } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import App from '../App';
import { AUTH_STORAGE_KEY } from '../lib/api';
import type { Order } from '../lib/types';

export const ADMIN_AUTH = {
  token: 'test-token',
  user: {
    id: 'u-admin',
    email: 'atelier@tanviagnihotry.in',
    firstName: 'Tanvi',
    lastName: 'Agnihotry',
    role: 'admin' as const,
  },
};

export function seedAdminAuth() {
  localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(ADMIN_AUTH));
}

export function renderApp(path: string) {
  return render(
    <MemoryRouter initialEntries={[path]}>
      <App />
    </MemoryRouter>,
  );
}

export interface FetchCall {
  url: string;
  method: string;
  body: unknown;
}

type RouteResult = { status?: number; json: unknown } | undefined;

/**
 * Stubs global fetch. The handler receives the full URL and init and returns
 * the JSON body to respond with (plus optional status). Records every call.
 */
export function mockFetch(handler: (url: string, init?: RequestInit) => RouteResult) {
  const calls: FetchCall[] = [];
  const fn = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = String(input);
    const method = init?.method ?? 'GET';
    calls.push({
      url,
      method,
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
    });
    const result = handler(url, init);
    if (!result) {
      return {
        ok: false,
        status: 404,
        json: async () => ({ error: `Unhandled ${method} ${url}` }),
      } as Response;
    }
    const status = result.status ?? 200;
    return {
      ok: status >= 200 && status < 300,
      status,
      json: async () => result.json,
    } as Response;
  });
  vi.stubGlobal('fetch', fn);
  return { fn, calls };
}

export function makeOrder(overrides: Partial<Order> = {}): Order {
  return {
    id: 'o1',
    orderNumber: 'TA-2026-04817',
    userId: null,
    email: 'meera@example.in',
    phone: '+91 98200 00000',
    firstName: 'Meera',
    lastName: 'Kapoor',
    addressLine1: '14 Altamount Road',
    addressLine2: '',
    city: 'Mumbai',
    state: 'Maharashtra',
    pincode: '400026',
    country: 'India',
    deliveryMethod: 'standard',
    deliveryFee: 0,
    subtotal: 18400000,
    total: 18400000,
    status: 'paid',
    channel: 'online',
    billType: null,
    billNumber: null,
    gstAmount: null,
    deliveryDueDate: null,
    notes: '',
    advancePaid: 0,
    balance: 18400000,
    receipts: [],
    createdAt: '2026-07-01T10:00:00.000Z',
    items: [
      {
        id: 'oi1',
        productId: 'p1',
        variantId: 'v1',
        productName: 'Emerald Court Gown',
        size: 'M',
        color: 'Emerald',
        unitPrice: 18400000,
        quantity: 1,
        imageUrl: null,
      },
    ],
    ...overrides,
  };
}
