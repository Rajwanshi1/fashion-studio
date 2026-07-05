import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DETAIL1, mockFetch, renderApp } from './helpers';

describe('PDP', () => {
  it('add to bag opens the drawer and shows the toast', async () => {
    mockFetch((url) => {
      if (url.includes('/api/products/sage-sequin-jacket-lehenga')) return DETAIL1;
      if (url.includes('/api/products')) return { items: [], total: 0, page: 1, pages: 1 };
      if (url.includes('/api/categories')) return [];
      return undefined;
    });

    renderApp('/product/sage-sequin-jacket-lehenga');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sage Sequin Jacket Lehenga' }),
    ).toBeInTheDocument();
    expect(screen.getByText('incl. of all taxes')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add to Bag' }));

    // Drawer slides open with the item inside.
    const drawer = screen.getByLabelText('Shopping bag');
    expect(drawer.className).toContain('open');
    expect(screen.getByText('Sage · Size S · Qty 1')).toBeInTheDocument();

    // Toast confirms.
    expect(screen.getByRole('status')).toHaveTextContent('Added to your bag');

    // Nav count is live.
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('disables out-of-stock sizes', async () => {
    mockFetch((url) => {
      if (url.includes('/api/products/sage-sequin-jacket-lehenga')) return DETAIL1;
      if (url.includes('/api/categories')) return [];
      return undefined;
    });
    renderApp('/product/sage-sequin-jacket-lehenga');
    await screen.findByRole('heading', { level: 1, name: 'Sage Sequin Jacket Lehenga' });
    expect(screen.getByRole('button', { name: 'L' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'S' })).toBeEnabled();
  });
});
