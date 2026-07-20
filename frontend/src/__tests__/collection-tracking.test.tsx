import { describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Providers } from '../App';
import Collection from '../pages/Collection';
import { CATEGORIES, mockFetch } from './helpers';

// Collection's filter_apply effect watches [colors, priceMax]. StrictMode
// double-invokes that effect on mount: a naive one-shot boolean guard
// ("have I run before?") is flipped false by invocation 1 and then read as
// false by invocation 2, which arms a real debounce timer and fires a
// spurious filter_apply with the *initial* filter values. The fix compares
// against a snapshot of the last-tracked {colors, priceMax} instead, so both
// StrictMode invocations see "unchanged" and bail. This test renders under
// StrictMode (the plain renderApp() helper does not use StrictMode, which
// is why the original bug slipped past the Task 3 test suite) and proves no
// filter_apply fires merely from mounting.
vi.mock('../lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/analytics')>();
  return { ...actual, track: vi.fn() };
});

import { track } from '../lib/analytics';

function productsPayload() {
  return { items: [], total: 0, page: 1, pages: 1 };
}

describe('Collection page — filter_apply mount guard', () => {
  it('does not fire filter_apply on mount, even under StrictMode double-invoke', async () => {
    mockFetch((url) => {
      if (url.includes('/api/categories')) return CATEGORIES;
      if (url.includes('/api/products')) return productsPayload();
      return undefined;
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/collection/lehenga-sets']}>
          <Providers>
            <Routes>
              <Route path="/collection/:categorySlug" element={<Collection />} />
            </Routes>
          </Providers>
        </MemoryRouter>
      </StrictMode>,
    );

    await screen.findByRole('heading', { level: 1, name: 'Lehenga Sets' });

    // Give the (buggy version's) 500ms debounce timer a chance to fire.
    await new Promise((resolve) => setTimeout(resolve, 600));

    const filterCalls = vi.mocked(track).mock.calls.filter(([type]) => type === 'filter_apply');
    expect(filterCalls).toHaveLength(0);
  });
});
