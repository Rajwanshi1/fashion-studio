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
            lowStock: [
              {
                variantId: 'v9',
                productId: 'p9',
                productName: 'Pistachio Threadwork Anarkali',
                size: 'XS',
                stock: 1,
              },
              {
                variantId: 'v10',
                productId: 'p9',
                productName: 'Pistachio Threadwork Anarkali',
                size: 'XL',
                stock: 2,
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
    expect(screen.getByText('Low Stock')).toBeInTheDocument();
    // low stock count card = 2 items
    expect(screen.getByText('2', { selector: '.stat .v' })).toBeInTheDocument();
    // low stock rows
    expect(screen.getAllByText('Pistachio Threadwork Anarkali')).toHaveLength(2);
    expect(screen.getByText('XS')).toBeInTheDocument();
    // recent orders table
    expect(screen.getByText('TA-2026-04817')).toBeInTheDocument();
    expect(screen.getByText('Meera Kapoor')).toBeInTheDocument();
    expect(screen.getByText('Paid')).toBeInTheDocument();
  });
});
