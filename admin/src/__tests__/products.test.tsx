import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';

const P1 = {
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
  collection: 'The Verdant Edit',
  craft: 'Zardozi',
  fabric: 'Silk',
  occasion: 'Wedding',
  dupattaPrice: null,
  jacketPrice: null,
  active: true,
  variants: [
    { id: 'v1', productId: 'p1', size: 'S', stock: 3 },
    { id: 'v2', productId: 'p1', size: 'M', stock: 4 },
  ],
};

const P2 = {
  id: 'p2',
  slug: 'rang-mehfil-lehenga',
  name: 'Rang Mehfil Lehenga',
  price: 32600000,
  color: 'Celadon',
  flag: null,
  imageUrl: null,
  categorySlug: 'lehenga',
  categoryName: 'Lehenga',
  description: '',
  details: '',
  collection: 'Festive Edit',
  craft: '',
  fabric: '',
  occasion: '',
  dupattaPrice: 800000,
  jacketPrice: null,
  active: false,
  variants: [{ id: 'v3', productId: 'p2', size: 'L', stock: 0 }],
};

describe('Products', () => {
  it('renders the inventory table from the API', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/admin/products')) return { json: [P1, P2] };
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
    // collection appears as both a filter chip and a table cell
    expect(screen.getAllByText('The Verdant Edit')).toHaveLength(2);
  });

  it('filters rows by collection chips', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/admin/products')) return { json: [P1, P2] };
      return undefined;
    });

    renderApp('/products');
    await screen.findByText('Emerald Court Gown');

    const chips = screen.getByRole('group', { name: 'Filter by collection' });
    await userEvent.click(within(chips).getByRole('button', { name: 'Festive Edit' }));
    expect(screen.queryByText('Emerald Court Gown')).not.toBeInTheDocument();
    expect(screen.getByText('Rang Mehfil Lehenga')).toBeInTheDocument();

    await userEvent.click(within(chips).getByRole('button', { name: 'All' }));
    expect(screen.getByText('Emerald Court Gown')).toBeInTheDocument();
  });

  it('filters rows by the list search across name, collection and category', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url) => {
      if (url.endsWith('/api/admin/products')) return { json: [P1, P2] };
      return undefined;
    });

    renderApp('/products');
    await screen.findByText('Emerald Court Gown');

    const search = screen.getByLabelText('Search pieces…');
    await userEvent.type(search, 'rang');
    expect(screen.queryByText('Emerald Court Gown')).not.toBeInTheDocument();
    expect(screen.getByText('Rang Mehfil Lehenga')).toBeInTheDocument();

    // category name
    await userEvent.clear(search);
    await userEvent.type(search, 'gowns');
    expect(screen.getByText('Emerald Court Gown')).toBeInTheDocument();
    expect(screen.queryByText('Rang Mehfil Lehenga')).not.toBeInTheDocument();

    // collection
    await userEvent.clear(search);
    await userEvent.type(search, 'festive');
    expect(screen.queryByText('Emerald Court Gown')).not.toBeInTheDocument();
    expect(screen.getByText('Rang Mehfil Lehenga')).toBeInTheDocument();

    await userEvent.clear(search);
    expect(screen.getByText('Emerald Court Gown')).toBeInTheDocument();

    // filtering never goes back to the API
    expect(calls.filter((c) => c.url.endsWith('/api/admin/products'))).toHaveLength(1);
  });

  it('selects pieces and bulk-deletes them behind a confirm sheet', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/products/bulk-delete') && init?.method === 'POST') {
        return {
          json: {
            results: [
              { id: 'p1', outcome: 'deleted' },
              { id: 'p2', outcome: 'archived' },
            ],
          },
        };
      }
      if (url.endsWith('/api/admin/products')) return { json: [P1, P2] };
      return undefined;
    });

    renderApp('/products');
    await screen.findByText('Emerald Court Gown');

    // Selecting rows swaps the header action to Delete.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all pieces' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete selected (2)' }));

    // Nothing is sent until the sheet is confirmed.
    const sheet = await screen.findByRole('dialog', { name: 'Delete 2 pieces?' });
    expect(within(sheet).getByText(/Emerald Court Gown, Rang Mehfil Lehenga/)).toBeInTheDocument();
    expect(within(sheet).getByText(/archived instead of deleted/)).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    await userEvent.click(within(sheet).getByRole('button', { name: 'Delete' }));

    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toMatch(/\/api\/admin\/products\/bulk-delete$/);
    expect(post?.body).toEqual({ ids: ['p1', 'p2'] });

    // Deleted and archived rows both leave the list; the toast reports the split.
    expect(await screen.findByText('1 deleted · 1 archived (has orders)')).toBeInTheDocument();
    expect(screen.queryByText('Emerald Court Gown')).not.toBeInTheDocument();
    expect(screen.queryByText('Rang Mehfil Lehenga')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Piece' })).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('backing out of the confirm sheet deletes nothing', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url) => {
      if (url.endsWith('/api/admin/products')) return { json: [P1, P2] };
      return undefined;
    });

    renderApp('/products');
    await screen.findByText('Emerald Court Gown');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Emerald Court Gown' }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete selected (1)' }));

    const sheet = await screen.findByRole('dialog', { name: 'Delete 1 piece?' });
    await userEvent.click(within(sheet).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);
    expect(screen.getByText('Emerald Court Gown')).toBeInTheDocument();
  });

  it('row checkboxes do not open the editor', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/admin/products')) return { json: [P1, P2] };
      return undefined;
    });

    renderApp('/products');
    await screen.findByText('Emerald Court Gown');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Emerald Court Gown' }));
    // Still on the list (the editor page would swap the heading).
    expect(screen.getByRole('heading', { name: 'Products' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Delete selected (1)' })).toBeInTheDocument();
  });
});
