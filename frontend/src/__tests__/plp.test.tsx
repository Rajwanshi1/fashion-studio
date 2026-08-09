import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { AppRoutes, Providers } from '../App';
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

/** renderApp() + a probe so ?color= URL syncing can be asserted directly. */
function LocationProbe() {
  const loc = useLocation();
  return (
    <>
      <span data-testid="loc">{loc.search}</span>
      {/* Category lives in the path, not the query string. */}
      <span data-testid="path">{loc.pathname}</span>
    </>
  );
}

function renderPlp(route: string) {
  return render(
    <MemoryRouter initialEntries={[route]}>
      <Providers>
        <AppRoutes />
        <LocationProbe />
      </Providers>
    </MemoryRouter>,
  );
}

const productUrls = (fetchMock: ReturnType<typeof mockFetch>) =>
  fetchMock.mock.calls.map((c) => String(c[0])).filter((u) => u.includes('/api/products'));

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

    renderApp('/collection/lehenga');

    expect((await screen.findAllByText('Sage Sequin Jacket Lehenga')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Moss Tissue Mirror Lehenga').length).toBeGreaterThan(0);
    expect(screen.getByText('2 Pieces')).toBeInTheDocument();
    expect(screen.getByRole('heading', { level: 1, name: 'Lehenga' })).toBeInTheDocument();
  });

  it('refetches server-side when a collection is picked, and filters occasions client-side', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      if (url.includes('/api/collections')) return ['Festive Edit', 'The Verdant Edit'];
      if (url.includes('/api/products')) return productsPayload();
      return undefined;
    });

    renderApp('/collection/lehenga');
    await screen.findAllByText('Sage Sequin Jacket Lehenga');

    const user = userEvent.setup();
    // Collection group is rendered from GET /api/collections.
    await user.click(await screen.findByRole('checkbox', { name: 'Festive Edit' }));
    await waitFor(() => {
      expect(productUrls(fetchMock).some((u) => u.includes('collection=Festive%20Edit'))).toBe(true);
    });

    // Occasion checkboxes now really filter (P1 = Wedding, P2 = Festive).
    await user.click(screen.getByRole('checkbox', { name: 'Wedding' }));
    expect(screen.getAllByText('Sage Sequin Jacket Lehenga').length).toBeGreaterThan(0);
    expect(screen.queryByText('Moss Tissue Mirror Lehenga')).not.toBeInTheDocument();
  });

  it('refetches with the chosen sort', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      if (url.includes('/api/products')) return productsPayload();
      return undefined;
    });

    renderApp('/collection/lehenga');
    await screen.findAllByText('Sage Sequin Jacket Lehenga');

    const user = userEvent.setup();
    await user.selectOptions(screen.getByLabelText('Sort'), 'price_asc');

    await waitFor(() => {
      expect(productUrls(fetchMock).some((u) => u.includes('sort=price_asc'))).toBe(true);
    });

    expect(track).toHaveBeenCalledWith('sort_change', {
      props: { category: 'lehenga', sort: 'price_asc' },
    });
  });

  it('filter_apply: skips the initial mount, debounces rapid changes, then fires once', async () => {
    mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      if (url.includes('/api/products')) return productsPayload();
      return undefined;
    });

    renderApp('/collection/lehenga');
    await screen.findAllByText('Sage Sequin Jacket Lehenga');

    // Initial render establishes color/priceMax without firing an event
    // (skip-initial-render guard).
    expect(track).not.toHaveBeenCalledWith('filter_apply', expect.anything());

    vi.useFakeTimers();
    // Colour is single-select, so the second swatch replaces the first.
    fireEvent.click(screen.getByRole('button', { name: 'Green' }));
    fireEvent.click(screen.getByRole('button', { name: 'Blue' }));

    // Still inside the 500ms debounce window — the price-slider-storm case.
    // act() wraps the advance because a colour change also re-runs the fetch.
    await act(async () => {
      await vi.advanceTimersByTimeAsync(400);
    });
    expect(track).not.toHaveBeenCalledWith('filter_apply', expect.anything());

    await act(async () => {
      await vi.advanceTimersByTimeAsync(150);
    });

    const filterCalls = vi.mocked(track).mock.calls.filter(([type]) => type === 'filter_apply');
    expect(filterCalls).toHaveLength(1);
    expect(filterCalls[0][1]).toEqual({
      props: { category: 'lehenga', color: 'blue', occasions: [], priceMax: 300000, collection: '' },
    });
  });

  it('swatches drive a server-side ?color= filter, URL-synced and single-select', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      // total deliberately != items.length: colour is a server filter, so the
      // API's total is what the count must show.
      if (url.includes('/api/products')) return { items: [P1, P2], total: 7, page: 1, pages: 1 };
      return undefined;
    });

    renderPlp('/collection/lehenga');
    await screen.findAllByText('Sage Sequin Jacket Lehenga');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Green' }));

    await waitFor(() => {
      expect(productUrls(fetchMock).some((u) => u.includes('&color=green'))).toBe(true);
    });
    expect(screen.getByTestId('loc')).toHaveTextContent('color=green');
    expect(screen.getByRole('button', { name: 'Green' })).toHaveClass('on');
    expect(screen.getByText('7 Pieces')).toBeInTheDocument();

    // Clicking the active swatch clears it again.
    await user.click(screen.getByRole('button', { name: 'Green' }));
    await waitFor(() => {
      expect(screen.getByTestId('loc')).not.toHaveTextContent('color=green');
    });
    const urls = productUrls(fetchMock);
    expect(urls[urls.length - 1]).not.toContain('color=');
  });

  it('hydrates the colour filter from the URL and clears it from the chip row', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      if (url.includes('/api/products')) return productsPayload();
      return undefined;
    });

    renderPlp('/collection/lehenga?color=pink');
    await screen.findAllByText('Sage Sequin Jacket Lehenga');

    expect(productUrls(fetchMock).every((u) => u.includes('&color=pink'))).toBe(true);
    expect(screen.getByRole('button', { name: 'Pink' })).toHaveClass('on');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove Pink' }));
    await waitFor(() => {
      expect(screen.getByTestId('loc')).not.toHaveTextContent('color=pink');
    });
    expect(screen.getByRole('button', { name: 'Pink' })).not.toHaveClass('on');
  });

  // The category is the route, so clearing it is a navigation to the slugless
  // PLP. Before this existed the checked box was a no-op and the chip's ✕ left
  // for the editorial page — there was no way to see the whole catalogue.
  it('unchecking the active category clears to the all-pieces route', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      if (url.includes('/api/products')) return productsPayload();
      return undefined;
    });

    renderPlp('/collection/lehenga');
    await screen.findAllByText('Sage Sequin Jacket Lehenga');
    expect(screen.getByRole('checkbox', { name: /^Lehenga/ })).toBeChecked();

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /^Lehenga/ }));

    await waitFor(() => {
      expect(screen.getByTestId('path')).toHaveTextContent('/collection');
    });
    expect(screen.getByTestId('path').textContent).toBe('/collection');
    expect(screen.getByRole('heading', { level: 1, name: 'All Pieces' })).toBeInTheDocument();
    expect(screen.getByRole('checkbox', { name: 'All Pieces' })).toBeChecked();
    expect(screen.getByRole('checkbox', { name: /^Lehenga/ })).not.toBeChecked();

    // An empty category= is what the API reads as "no category filter".
    const urls = productUrls(fetchMock);
    expect(urls[urls.length - 1]).toContain('category=&');
  });

  it("clears the category from the chip's ✕, keeping the other refinements", async () => {
    mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      if (url.includes('/api/products')) return productsPayload();
      return undefined;
    });

    renderPlp('/collection/lehenga?color=pink');
    await screen.findAllByText('Sage Sequin Jacket Lehenga');

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Remove Lehenga' }));

    await waitFor(() => {
      expect(screen.getByTestId('path').textContent).toBe('/collection');
    });
    expect(screen.getByTestId('loc')).toHaveTextContent('color=pink');
    expect(screen.queryByRole('button', { name: 'Remove Lehenga' })).not.toBeInTheDocument();
  });

  it('lists the whole catalogue on the slugless route, with no category chip', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      if (url.includes('/api/products')) return productsPayload();
      return undefined;
    });

    renderPlp('/collection');

    expect((await screen.findAllByText('Sage Sequin Jacket Lehenga')).length).toBeGreaterThan(0);
    expect(screen.getAllByText('Moss Tissue Mirror Lehenga').length).toBeGreaterThan(0);
    expect(screen.getByRole('checkbox', { name: 'All Pieces' })).toBeChecked();
    CATEGORIES.forEach((c) => {
      expect(screen.getByRole('checkbox', { name: new RegExp(`^${c.name}`) })).not.toBeChecked();
    });
    expect(screen.queryByRole('button', { name: /^Remove (Kaftan|Anarkali|Suits|Lehenga|Antifit)$/ })).not.toBeInTheDocument();
    expect(productUrls(fetchMock).every((u) => u.includes('category=&'))).toBe(true);
  });

  it('checking a category from the all-pieces route filters to it', async () => {
    const fetchMock = mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      if (url.includes('/api/products')) return productsPayload();
      return undefined;
    });

    renderPlp('/collection');
    await screen.findAllByText('Sage Sequin Jacket Lehenga');

    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /^Anarkali/ }));

    await waitFor(() => {
      expect(screen.getByTestId('path').textContent).toBe('/collection/anarkali');
    });
    expect(screen.getByRole('checkbox', { name: 'All Pieces' })).not.toBeChecked();
    const urls = productUrls(fetchMock);
    expect(urls[urls.length - 1]).toContain('category=anarkali');
  });

  it('prices a sale card with the pre-sale total struck through', async () => {
    mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      if (url.includes('/api/products')) return productsPayload();
      return undefined;
    });

    renderApp('/collection/lehenga');
    await screen.findAllByText('Moss Tissue Mirror Lehenga');

    // P2 is on sale: base 1,72,000 → 1,29,000.
    const struck = screen.getByText('₹1,72,000');
    expect(struck.tagName).toBe('S');
    expect(struck).toHaveClass('was');
    expect(screen.getByText('₹1,29,000')).toBeInTheDocument();
    expect(screen.getByText('Sale')).toBeInTheDocument();
    // P1 is not on sale — one price, no strike.
    expect(screen.getByText('₹1,84,000').tagName).not.toBe('S');
  });

  it('shows a graceful error state on API 404s', async () => {
    mockFetch(() => undefined);
    renderApp('/collection/lehenga');
    expect(await screen.findByText('Not found')).toBeInTheDocument();
  });

  it('renders gracefully when the API is unreachable', async () => {
    mockFetchDown();
    renderApp('/collection/lehenga');
    // Chrome still renders; results area shows a calm error note.
    expect(
      await screen.findByText('The atelier is unreachable right now.'),
    ).toBeInTheDocument();
    expect(screen.getAllByText('Tanvi Agnihotry').length).toBeGreaterThan(0);
  });
});
