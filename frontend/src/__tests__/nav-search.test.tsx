import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppRoutes, Providers } from '../App';
import { mockFetch, P1, P2 } from './helpers';

// Mocked so the search dedupe-ref guard can be asserted directly, without
// coupling this test to the analytics module's batching/flush network
// mechanics (already covered by analytics.test.ts).
vi.mock('../lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/analytics')>();
  return { ...actual, track: vi.fn() };
});

import { track } from '../lib/analytics';

/** renderApp() + a probe so "opening must not navigate" can be asserted. */
function LocationProbe() {
  const loc = useLocation();
  return <span data-testid="path">{loc.pathname}</span>;
}

/** A static shop page (client care) — nav chrome without product-card links. */
function renderShop() {
  return render(
    <MemoryRouter initialEntries={['/client-care']}>
      <Providers>
        <AppRoutes />
        <LocationProbe />
      </Providers>
    </MemoryRouter>,
  );
}

const searchUrls = (fetchMock: ReturnType<typeof mockFetch>) =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('search='));

describe('NavSearch', () => {
  afterEach(() => {
    vi.mocked(track).mockClear();
    vi.useRealTimers();
  });

  it('opens inline from the nav trigger: focused input, no navigation', () => {
    mockFetch(() => undefined);
    renderShop();

    const trigger = screen.getByRole('link', { name: 'Search' });
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(trigger);

    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('textbox', { name: 'Search' })).toHaveFocus();
    expect(screen.getByTestId('path')).toHaveTextContent('/client-care');
  });

  it('debounces 300ms, fetches 6 quick hits, links rows to the PDP and View-all to /search', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('/api/products?search=sage')) return { items: [P1, P2], total: 8, page: 1, pages: 2 };
      return undefined;
    });

    renderShop();
    fireEvent.click(screen.getByRole('link', { name: 'Search' }));
    vi.useFakeTimers();

    fireEvent.change(screen.getByRole('textbox', { name: 'Search' }), { target: { value: 'sage' } });
    await act(() => vi.advanceTimersByTimeAsync(200));
    expect(searchUrls(fetchMock)).toHaveLength(0); // still inside the debounce window
    await act(() => vi.advanceTimersByTimeAsync(100));

    const urls = searchUrls(fetchMock);
    expect(urls).toHaveLength(1);
    expect(urls[0]).toContain('search=sage');
    expect(urls[0]).toContain('page=1&limit=6');

    expect(screen.getByRole('link', { name: /Sage Sequin Jacket Lehenga/ })).toHaveAttribute(
      'href',
      '/product/sage-sequin-jacket-lehenga',
    );
    expect(screen.getByRole('link', { name: 'View all 8 results' })).toHaveAttribute(
      'href',
      '/search?q=sage',
    );
  });

  it('dedupes consecutive identical queries via ref, firing search only once', async () => {
    mockFetch((url) => {
      if (url.includes('/api/products?search=sage')) return { items: [P1], total: 3, page: 1, pages: 1 };
      return undefined;
    });

    renderShop();
    fireEvent.click(screen.getByRole('link', { name: 'Search' }));
    vi.useFakeTimers();

    const input = screen.getByRole('textbox', { name: 'Search' });
    fireEvent.change(input, { target: { value: 'sage' } });
    await act(() => vi.advanceTimersByTimeAsync(300));

    let searchCalls = vi.mocked(track).mock.calls.filter(([type]) => type === 'search');
    expect(searchCalls).toHaveLength(1);
    expect(searchCalls[0][1]).toEqual({ props: { query: 'sage', results: 3 } });

    // Re-typed to the same trimmed query — the debounced fetch re-runs, but
    // the dedupe ref must suppress a second identical `search` event.
    fireEvent.change(input, { target: { value: 'sag' } });
    fireEvent.change(input, { target: { value: 'sage' } });
    await act(() => vi.advanceTimersByTimeAsync(300));

    searchCalls = vi.mocked(track).mock.calls.filter(([type]) => type === 'search');
    expect(searchCalls).toHaveLength(1);
  });

  it('Escape closes and unmounts the bar', () => {
    mockFetch(() => undefined);
    renderShop();

    const trigger = screen.getByRole('link', { name: 'Search' });
    fireEvent.click(trigger);
    expect(screen.getByRole('textbox', { name: 'Search' })).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('textbox', { name: 'Search' })).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
  });
});
