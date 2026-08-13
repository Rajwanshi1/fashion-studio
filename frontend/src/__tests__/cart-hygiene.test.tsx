import { describe, expect, it } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import { CartProvider, useCart } from '../lib/cart';
import { mockFetch } from './helpers';

function Probe() {
  const { items } = useCart();
  return <div data-testid="count">{items.length}</div>;
}

const line = (over: Record<string, unknown> = {}) => ({
  variantId: 'v1',
  productId: 'p1',
  productSlug: 'sage-sequin-jacket-lehenga',
  name: 'Sage Sequin Jacket Lehenga',
  size: 'S',
  color: 'Sage',
  unitPrice: 18400000,
  qty: 1,
  imageUrl: null,
  includeDupatta: false,
  includeJacket: false,
  dupattaPrice: null,
  jacketPrice: null,
  measurements: '',
  addedAt: Date.now(),
  ...over,
});

const DETAIL = { id: 'p1', slug: 'sage-sequin-jacket-lehenga', variants: [{ id: 'v1' }] };

describe('cart hygiene', () => {
  it('drops lines older than 30 days on load', () => {
    localStorage.setItem(
      'ta.cart',
      JSON.stringify([line({ addedAt: Date.now() - 31 * 24 * 60 * 60 * 1000 })]),
    );
    mockFetch(() => undefined);
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
    expect(screen.getByTestId('count').textContent).toBe('0');
  });

  it('drops a line whose size has left the catalogue, keeps live ones', async () => {
    localStorage.setItem(
      'ta.cart',
      JSON.stringify([line(), line({ variantId: 'ghost', size: 'M' })]),
    );
    mockFetch((url) => {
      if (url.includes('/api/products/sage-sequin-jacket-lehenga')) return DETAIL;
      return undefined;
    });
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });

  it('keeps every line when the network is down (fail-open)', async () => {
    localStorage.setItem('ta.cart', JSON.stringify([line({ variantId: 'ghost' })]));
    mockFetch(() => {
      throw new Error('offline');
    });
    render(
      <CartProvider>
        <Probe />
      </CartProvider>,
    );
    // Give the reconcile a beat to (not) act.
    await waitFor(() => expect(screen.getByTestId('count').textContent).toBe('1'));
  });
});
