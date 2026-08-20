import { describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, Route, Routes } from 'react-router-dom';
import { Providers } from '../App';
import Product from '../pages/Product';
import { DETAIL1, mockFetch } from './helpers';

// Product's product-load effect fetches by slug; StrictMode double-invokes
// that effect in dev, firing two independent requests that both land in
// setProduct(). A useRef guard (lastTrackedSlugRef) ensures product_view
// only tracks once per slug regardless. We mock the analytics module's
// `track` export directly (rather than asserting on the network layer) so
// this test is about the guard, not about batching/flush mechanics already
// covered by analytics.test.ts.
vi.mock('../lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/analytics')>();
  return { ...actual, track: vi.fn() };
});

import { track } from '../lib/analytics';

describe('Product page — product_view tracking', () => {
  it('fires product_view exactly once despite StrictMode double-invoking the load effect', async () => {
    mockFetch((url) => {
      if (url.includes('/api/products/sage-sequin-jacket-lehenga')) return DETAIL1;
      return undefined;
    });

    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/product/sage-sequin-jacket-lehenga']}>
          <Providers>
            <Routes>
              <Route path="/product/:slug" element={<Product />} />
            </Routes>
          </Providers>
        </MemoryRouter>
      </StrictMode>,
    );

    await screen.findByRole('heading', { level: 1, name: 'Sage Sequin Jacket Lehenga' });

    const productViewCalls = vi
      .mocked(track)
      .mock.calls.filter(([type]) => type === 'product_view');
    expect(productViewCalls).toHaveLength(1);
    expect(productViewCalls[0][1]).toEqual({
      productId: 'p1',
      props: {
        slug: 'sage-sequin-jacket-lehenga',
        name: 'Sage Sequin Jacket Lehenga',
        price: 18400000,
      },
    });
  });

  it('the custom colour chip fires color_select with the custom source', async () => {
    mockFetch((url) => {
      if (url.includes('/api/products/sage-sequin-jacket-lehenga')) return DETAIL1;
      return undefined;
    });

    render(
      <MemoryRouter initialEntries={['/product/sage-sequin-jacket-lehenga']}>
        <Providers>
          <Routes>
            <Route path="/product/:slug" element={<Product />} />
          </Routes>
        </Providers>
      </MemoryRouter>,
    );
    await screen.findByRole('heading', { level: 1, name: 'Sage Sequin Jacket Lehenga' });

    fireEvent.click(screen.getByRole('button', { name: 'Custom colour' }));
    expect(track).toHaveBeenCalledWith('color_select', {
      productId: 'p1',
      props: { color: 'custom', source: 'custom' },
    });
  });
});
