import { beforeEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { resetFirstOrderOfferCache } from '../lib/offers';
import { mockFetch, renderApp, seedCart } from './helpers';

const OFFER_URL = '/api/orders/me/first-order-offer';
const DIALOG = { name: 'First order offer' };

function seedAuth() {
  localStorage.setItem(
    'ta.auth',
    JSON.stringify({
      token: 'test-token',
      user: { id: 'u1', email: 'aanya@example.com', phone: null, firstName: 'Aanya', lastName: 'Mehra', role: 'customer' },
    }),
  );
}

function baseRoutes(url: string) {
  if (url.includes('/api/categories')) return [];
  if (url.includes('/api/products')) return { items: [], total: 0, page: 1, pages: 1 };
  return undefined;
}

/** Render on fake timers and walk past the pop-up's ~2s delay. */
async function renderPastDelay(route: string) {
  renderApp(route);
  await act(async () => {
    vi.advanceTimersByTime(2100);
  });
}

describe('first-order pop-up', () => {
  beforeEach(() => {
    resetFirstOrderOfferCache();
    vi.useFakeTimers();
    return () => vi.useRealTimers();
  });

  it('appears once after ~2s on a fresh visit; dismissal sets the flag', async () => {
    mockFetch(baseRoutes);
    renderApp('/');
    expect(screen.queryByRole('dialog', DIALOG)).not.toBeInTheDocument();
    await act(async () => {
      vi.advanceTimersByTime(2100);
    });
    expect(screen.getByRole('dialog', DIALOG)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Your first order — 5% off' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Maybe later' }));
    expect(screen.queryByRole('dialog', DIALOG)).not.toBeInTheDocument();
    expect(localStorage.getItem('ta.offer-seen')).toBe('1');
  });

  it('the CTA leads to sign-in and never nags again', async () => {
    mockFetch(baseRoutes);
    await renderPastDelay('/');
    fireEvent.click(screen.getByRole('link', { name: 'Sign in' }));
    expect(screen.queryByRole('dialog', DIALOG)).not.toBeInTheDocument();
    expect(localStorage.getItem('ta.offer-seen')).toBe('1');
  });

  it('stays hidden once the flag is set', async () => {
    localStorage.setItem('ta.offer-seen', '1');
    mockFetch(baseRoutes);
    await renderPastDelay('/');
    expect(screen.queryByRole('dialog', DIALOG)).not.toBeInTheDocument();
  });

  it('stays off the checkout route', async () => {
    seedCart();
    mockFetch(baseRoutes);
    await renderPastDelay('/checkout');
    expect(screen.queryByRole('dialog', DIALOG)).not.toBeInTheDocument();
  });

  it('stays hidden for a signed-in shopper who already ordered', async () => {
    seedAuth();
    mockFetch((url) => (url.includes(OFFER_URL) ? { eligible: false, percentOff: 5 } : baseRoutes(url)));
    await renderPastDelay('/');
    expect(screen.queryByRole('dialog', DIALOG)).not.toBeInTheDocument();
  });
});

describe('checkout discount preview', () => {
  beforeEach(() => resetFirstOrderOfferCache());

  it('shows the discount line and reduced total for an eligible signed-in shopper', async () => {
    seedCart();
    seedAuth();
    localStorage.setItem('ta.offer-seen', '1');
    mockFetch((url) => (url.includes(OFFER_URL) ? { eligible: true, percentOff: 5 } : baseRoutes(url)));
    renderApp('/checkout');
    expect(await screen.findByText('First order − 5%')).toBeInTheDocument();
    expect(screen.getByText('−₹9,200')).toBeInTheDocument(); // floor(18400000 × 5%)
    expect(screen.getByRole('button', { name: 'Place Order · ₹1,74,800' })).toBeInTheDocument();
  });

  it('shows no discount line for guests', () => {
    seedCart();
    mockFetch(baseRoutes);
    renderApp('/checkout');
    expect(screen.queryByText('First order − 5%')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Place Order · ₹1,84,000' })).toBeInTheDocument();
  });
});

describe('cart page', () => {
  beforeEach(() => resetFirstOrderOfferCache());

  it('the dead promo-code input is gone', () => {
    seedCart();
    mockFetch(baseRoutes);
    renderApp('/cart');
    expect(screen.queryByPlaceholderText('Gift card or promo code')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument();
  });

  it('previews the discount for an eligible signed-in shopper', async () => {
    seedCart();
    seedAuth();
    localStorage.setItem('ta.offer-seen', '1');
    mockFetch((url) => (url.includes(OFFER_URL) ? { eligible: true, percentOff: 5 } : baseRoutes(url)));
    renderApp('/cart');
    expect(await screen.findByText('First order − 5%')).toBeInTheDocument();
    expect(screen.getByText('₹1,74,800')).toBeInTheDocument(); // total reflects the preview
  });
});
