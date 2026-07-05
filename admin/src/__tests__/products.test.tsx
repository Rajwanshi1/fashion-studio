import { screen } from '@testing-library/react';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';

describe('Products', () => {
  it('renders the inventory table from the API', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/admin/products')) {
        return {
          json: [
            {
              id: 'p1',
              slug: 'emerald-court-gown',
              name: 'Emerald Court Gown',
              price: 18400000,
              color: 'Emerald',
              flag: 'bestseller',
              imageUrl: null,
              categorySlug: 'gowns',
              categoryName: 'Gowns',
              description: '',
              details: '',
              active: true,
              variants: [
                { id: 'v1', productId: 'p1', size: 'S', stock: 3 },
                { id: 'v2', productId: 'p1', size: 'M', stock: 4 },
              ],
            },
            {
              id: 'p2',
              slug: 'rang-mehfil-lehenga',
              name: 'Rang Mehfil Lehenga',
              price: 32600000,
              color: 'Celadon',
              flag: null,
              imageUrl: null,
              categorySlug: 'lehenga-sets',
              categoryName: 'Lehenga Sets',
              description: '',
              details: '',
              active: false,
              variants: [{ id: 'v3', productId: 'p2', size: 'L', stock: 0 }],
            },
          ],
        };
      }
      return undefined;
    });

    renderApp('/products');

    expect(await screen.findByText('Emerald Court Gown')).toBeInTheDocument();
    expect(screen.getByText('Rang Mehfil Lehenga')).toBeInTheDocument();
    expect(screen.getByText('₹1,84,000')).toBeInTheDocument();
    expect(screen.getByText('₹3,26,000')).toBeInTheDocument();
    expect(screen.getByText('Gowns')).toBeInTheDocument();
    expect(screen.getByText('Bestseller')).toBeInTheDocument();
    expect(screen.getByText('Active')).toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
    // total stock = 3 + 4
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Piece' })).toBeInTheDocument();
  });
});
