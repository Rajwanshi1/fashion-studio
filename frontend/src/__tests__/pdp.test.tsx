import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DETAIL1, DETAIL_SET, mockFetch, renderApp } from './helpers';

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

  it('set includes: pieces default on, unticking reprices, cart gets the selection', async () => {
    mockFetch((url) => {
      if (url.includes('/api/products/fern-zardozi-set-fern')) return DETAIL_SET;
      if (url.includes('/api/products')) return { items: [], total: 0, page: 1, pages: 1 };
      if (url.includes('/api/categories')) return [];
      return undefined;
    });

    renderApp('/product/fern-zardozi-set-fern');
    await screen.findByRole('heading', { level: 1, name: 'Fern Zardozi Set' });

    // Full set by default: 150000 + 12000 + 24000 rupees.
    expect(screen.getByText('₹1,86,000')).toBeInTheDocument();
    const dupatta = screen.getByRole('checkbox', { name: /Dupatta/ });
    const jacket = screen.getByRole('checkbox', { name: /Jacket/ });
    expect(dupatta).toBeChecked();
    expect(jacket).toBeChecked();

    // Removing the jacket drops its price from the total.
    const user = userEvent.setup();
    await user.click(jacket);
    expect(screen.getByText('₹1,62,000')).toBeInTheDocument();

    // The cart line carries the selection and the re-priced unit.
    await user.click(screen.getByRole('button', { name: 'Add to Bag' }));
    expect(screen.getByText('Sage · Size M · Qty 1 · With dupatta')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem('ta.cart') ?? '[]');
    expect(stored[0]).toMatchObject({
      includeDupatta: true,
      includeJacket: false,
      dupattaPrice: 1200000,
      jacketPrice: null,
      unitPrice: 16200000,
    });
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
