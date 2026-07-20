import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, fireEvent, screen } from '@testing-library/react';
import { mockFetch, renderApp } from './helpers';

// Mocked so the search dedupe-ref guard can be asserted directly, without
// coupling this test to the analytics module's batching/flush network
// mechanics (already covered by analytics.test.ts).
vi.mock('../lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/analytics')>();
  return { ...actual, track: vi.fn() };
});

import { track } from '../lib/analytics';

function resultsPayload(total: number) {
  return { items: [], total, page: 1, pages: 1 };
}

describe('Search', () => {
  afterEach(() => {
    vi.mocked(track).mockClear();
    vi.useRealTimers();
  });

  it('dedupes consecutive identical queries via ref, firing search only once', async () => {
    mockFetch((url) => {
      if (url.includes('/api/products?search=sage')) return resultsPayload(3);
      return undefined;
    });

    renderApp('/search');
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
});
