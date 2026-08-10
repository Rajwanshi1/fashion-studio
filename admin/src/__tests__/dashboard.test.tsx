import { screen } from '@testing-library/react';
import { makeOrder, mockFetch, renderApp, seedAdminAuth } from '../test/utils';

describe('Dashboard', () => {
  it('renders summary cards, low stock and recent orders from the API', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/admin/summary')) {
        return {
          json: {
            activeOrders: 12,
            revenue: 32600000,
            pendingPayments: 3,
            pendingToCollect: 150000,
            // One row per fully-out piece, not per zero variant.
            lowStock: [
              {
                productId: 'p9',
                productName: 'Pistachio Threadwork Anarkali',
                color: 'Pistachio',
                imageUrl: null,
              },
              {
                productId: 'p10',
                productName: 'Fern Zardozi Set',
                color: 'Fern',
                imageUrl: 'https://cdn.test/fern.jpg',
              },
            ],
            recentOrders: [makeOrder()],
          },
        };
      }
      return undefined;
    });

    renderApp('/');

    expect(await screen.findByText('Active Orders')).toBeInTheDocument();
    expect(screen.getByText('12')).toBeInTheDocument();
    // Money cards report what was actually received and what is still owed.
    expect(screen.getByText('Collected')).toBeInTheDocument();
    expect(screen.getByText('₹3,26,000')).toBeInTheDocument();
    expect(screen.getByText('To Collect')).toBeInTheDocument();
    expect(screen.getByText('₹1,500')).toBeInTheDocument();
    expect(screen.getByText('3 orders with balance due')).toBeInTheDocument();
    expect(screen.getByText('Out of Stock')).toBeInTheDocument();
    // out-of-stock count card = 2 pieces
    expect(screen.getByText('2', { selector: '.stat .v' })).toBeInTheDocument();
    // one row per piece, with colour and a way straight into the editor
    expect(screen.getByText('Pistachio Threadwork Anarkali')).toBeInTheDocument();
    expect(screen.getByText('Fern Zardozi Set')).toBeInTheDocument();
    expect(screen.getAllByRole('link', { name: 'Open piece' })).toHaveLength(2);
    // recent orders table
    expect(screen.getByText('TA-2026-04817')).toBeInTheDocument();
    expect(screen.getByText('Meera Kapoor')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });
});
