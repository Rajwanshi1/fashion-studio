import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';

const PRODUCTS = [
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
];

describe('Products', () => {
  it('renders the inventory table from the API', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/admin/products')) return { json: PRODUCTS };
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

  it('expands a quick-edit panel on row click instead of navigating', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/admin/products')) return { json: PRODUCTS };
      return undefined;
    });

    renderApp('/products');

    await userEvent.click(await screen.findByText('Emerald Court Gown'));

    // still on the list — the panel opens inline with per-size stocks
    expect(screen.getByRole('heading', { name: 'Products' })).toBeInTheDocument();
    expect(screen.getByLabelText('S')).toHaveValue(3);
    expect(screen.getByLabelText('M')).toHaveValue(4);
    expect(screen.getByLabelText('Visible in the boutique')).toBeChecked();
    expect(screen.getByRole('link', { name: 'Open full editor →' })).toHaveAttribute(
      'href',
      '/products/p1',
    );

    // clicking the row again collapses the panel
    await userEvent.click(screen.getByText('Emerald Court Gown'));
    expect(screen.queryByLabelText('S')).not.toBeInTheDocument();
  });
});
