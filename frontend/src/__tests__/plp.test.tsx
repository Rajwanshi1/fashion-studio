import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { CATEGORIES, mockFetch, mockFetchDown, P1, P2, renderApp } from './helpers';

function productsPayload() {
  return { items: [P1, P2], total: 2, page: 1, pages: 1 };
}

describe('PLP', () => {
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
