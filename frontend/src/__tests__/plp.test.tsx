import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATEGORIES, mockFetch, mockFetchDown, P1, P2, renderApp } from './helpers';

// Mocked so the new filter_apply/sort_change instrumentation (wired in this
// task) can be asserted directly, without coupling these tests to the
// analytics module's batching/flush network mechanics (already covered by
// analytics.test.ts).
vi.mock('../lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/analytics')>();
  return { ...actual, track: vi.fn() };
});

import { track } from '../lib/analytics';

function productsPayload() {
  return { items: [P1, P2], total: 2, page: 1, pages: 1 };
}

describe('PLP', () => {
  afterEach(() => {
    vi.mocked(track).mockClear();
    vi.useRealTimers();
  });

  it('renders products from the API', async () => {
    mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      if (url.includes('/api/products')) return productsPayload();
      return undefined;
    });

    renderApp('/collection/lehenga-sets');

    expect((await screen.findAllByText('Sage Sequin Jacket Lehenga')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Moss Tissue Mirror Lehenga').length).toBeGreaterThan(0);
    expect(screen.getByText('2 Pieces')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Lehenga Sets' })).toBeInTheDocument();
  });

  it('refetches with the chosen sort', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      if (url.includes('/api/products')) return productsPayload();
      return undefined;
    });

    renderApp('/collection/lehenga-sets');
    await screen.findAllByText('Sage Sequin Jacket Lehenga');

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Sort'), 'price_asc');

    await waitFor(() => {
      const productCalls = fetchMock.mock.calls
        .map((c) => String(c[0]))
        .filter((u) => u.includes('/api/products'));
      expect(productCalls.some((u) => u.includes('sort=price_asc'))).toBe(true);
    });

    expect(track).toHaveBeenCalledWith('sort_change', {
      props: { category: 'lehenga-sets', sort: 'price_asc' },
    });
  });

  it('filter_apply: skips the initial mount, debounces rapid changes, then fires once', async () => {
    mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      if (url.includes('/api/products')) return productsPayload();
      return undefined;
    });

    renderApp('/collection/lehenga-sets');
    await screen.findAllByText('Sage Sequin Jacket Lehenga');

    // Initial render establishes colors/priceMax without firing an event
    // (skip-initial-render guard).
    expect(track).not.toHaveBeenCalledWith('filter_apply', expect.anything());

    vi.useFakeTimers();
    fireEvent.click(screen.getByRole('button', { name: 'Sage' }));
    fireEvent.click(screen.getByRole('button', { name: 'Moss' }));

    // Still inside the 500ms debounce window — the price-slider-storm case.
    await vi.advanceTimersByTimeAsync(400);
    expect(track).not.toHaveBeenCalledWith('filter_apply', expect.anything());

    await vi.advanceTimersByTimeAsync(150);

    const filterCalls = vi.mocked(track).mock.calls.filter(([type]) => type === 'filter_apply');
    expect(filterCalls).toHaveLength(1);
    expect(filterCalls[0][1]).toEqual({
      props: { category: 'lehenga-sets', colors: ['Sage', 'Moss'], priceMax: 300000 },
    });
  });

  it('shows a graceful error state on API 404s', async () => {
    mockFetch(() => undefined);
    renderApp('/collection/lehenga-sets');
    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });

  it('renders gracefully when the API is unreachable', async () => {
    mockFetchDown();
    renderApp('/collection/lehenga-sets');
    // Chrome still renders; results area shows a calm error note.
    expect(
      await screen.findByText('The atelier is unreachable right now.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Tanvi Agnihotry').length).toBeGreaterThan(0);
  });
});
