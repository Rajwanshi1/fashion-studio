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
  imageUrl: 'https://cdn.test/emerald-1.jpg',
  categorySlug: 'gowns',
  categoryName: 'Gowns',
  description: '',
  details: '',
  collection: 'The Verdant Edit',
  craft: 'Zardozi',
  fabric: 'Silk',
  occasion: 'Wedding',
  addonsTotal: 0,
  components: [],
  colorFamily: 'green',
  salePrice: null,
  costPrice: null,
  // Five frames on purpose: the table shows the first three.
  images: [1, 2, 3, 4, 5].map((n) => ({ url: `https://cdn.test/emerald-${n}.jpg`, pose: '' })),
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
  addonsTotal: 800000,
  components: [{ id: 'pc1', name: 'Dupatta', optional: true, price: 800000 }],
  colorFamily: null,
  salePrice: null,
  costPrice: null,
  images: [],
  active: false,
  variants: [{ id: 'v3', productId: 'p2', size: 'L', stock: 0 }],
};

/** The catalogue endpoint, for the many tests that only need it to load. */
const catalogOnly = (url: string) =>
  url.endsWith('/api/admin/products') ? { json: [P1, P2] } : undefined;

describe('Products', () => {
  it('renders the inventory table from the API', async () => {
    seedAdminAuth();
    mockFetch(catalogOnly);

    renderApp('/products');

    expect(await screen.findByText('Emerald Court Gown')).toBeInTheDocument();
    // Scoped to the table: category and fabric names also appear as filter options.
    const table = within(screen.getByRole('table'));
    expect(table.getByText('Rang Mehfil Lehenga')).toBeInTheDocument();
    expect(table.getByText('₹1,84,000')).toBeInTheDocument();
    expect(table.getByText('₹3,26,000')).toBeInTheDocument();
    expect(table.getByText('Gowns')).toBeInTheDocument();
    expect(table.getByText('Bestseller')).toBeInTheDocument();
    expect(table.getByText('Active')).toBeInTheDocument();
    expect(table.getByText('Hidden')).toBeInTheDocument();
    // total stock = 3 + 4
    expect(table.getByText('7')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Piece' })).toBeInTheDocument();
    // collection appears as both a filter chip and a table cell
    expect(screen.getAllByText('The Verdant Edit')).toHaveLength(2);
    // colour and fabric columns
    expect(table.getByText('Emerald')).toBeInTheDocument();
    expect(table.getByText('Silk')).toBeInTheDocument();
  });

  it('shows the first three gallery frames and links live pieces to the storefront', async () => {
    seedAdminAuth();
    mockFetch(catalogOnly);

    renderApp('/products');
    await screen.findByText('Emerald Court Gown');

    // Five images in the gallery, three in the table.
    const thumbs = screen.getAllByRole('presentation');
    expect(thumbs).toHaveLength(3);
    expect(thumbs[0]).toHaveAttribute('src', 'https://cdn.test/emerald-1.jpg');
    expect(thumbs[2]).toHaveAttribute('src', 'https://cdn.test/emerald-3.jpg');

    // Active piece links out; hidden pieces 404 on the storefront, so no link.
    const link = screen.getByRole('link', { name: /View/ });
    expect(link).toHaveAttribute('href', 'http://localhost:5173/product/emerald-court-gown');
    expect(link).toHaveAttribute('target', '_blank');
    expect(screen.getByText('Not live')).toBeInTheDocument();
  });

  it('filters rows by collection chips', async () => {
    seedAdminAuth();
    mockFetch(catalogOnly);

    renderApp('/products');
    await screen.findByText('Emerald Court Gown');

    const chips = screen.getByRole('group', { name: 'Filter by collection' });
    await userEvent.click(within(chips).getByRole('button', { name: 'Festive Edit' }));
    expect(screen.queryByText('Emerald Court Gown')).not.toBeInTheDocument();
    expect(screen.getByText('Rang Mehfil Lehenga')).toBeInTheDocument();

    await userEvent.click(within(chips).getByRole('button', { name: 'All' }));
    expect(screen.getByText('Emerald Court Gown')).toBeInTheDocument();
  });

  it('narrows the table by category, fabric, visibility and price', async () => {
    seedAdminAuth();
    mockFetch(catalogOnly);

    renderApp('/products');
    await screen.findByText('Emerald Court Gown');
    expect(screen.getByText('Showing 2 of 2 pieces')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Category'), 'lehenga');
    expect(screen.queryByText('Emerald Court Gown')).not.toBeInTheDocument();
    expect(screen.getByText('Showing 1 of 2 pieces')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(screen.getByText('Emerald Court Gown')).toBeInTheDocument();

    await userEvent.selectOptions(screen.getByLabelText('Fabric'), 'Silk');
    expect(screen.queryByText('Rang Mehfil Lehenga')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    await userEvent.selectOptions(screen.getByLabelText('Visibility'), 'hidden');
    expect(screen.queryByText('Emerald Court Gown')).not.toBeInTheDocument();
    expect(screen.getByText('Rang Mehfil Lehenga')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    // ₹1,84,000 stays, ₹3,26,000 goes.
    await userEvent.type(screen.getByLabelText('Max ₹'), '200000');
    expect(screen.getByText('Emerald Court Gown')).toBeInTheDocument();
    expect(screen.queryByText('Rang Mehfil Lehenga')).not.toBeInTheDocument();
  });

  /** Every bulk action confirms in the in-app modal (never window.confirm). */
  const confirmInDialog = async (name: string | RegExp) => {
    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name }));
  };

  it('puts the selection on sale at a percentage and reloads the saved prices', async () => {
    seedAdminAuth();
    // The server computes the sale price; the page must show what came back.
    let onSale = false;
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/products/bulk-update') && init?.method === 'POST') {
        onSale = true;
        return { json: { results: [{ id: 'p1', outcome: 'updated' }] } };
      }
      if (url.endsWith('/api/admin/products')) {
        return { json: [onSale ? { ...P1, flag: 'sale', salePrice: 14720000 } : P1, P2] };
      }
      return undefined;
    });

    renderApp('/products');
    await screen.findByText('Emerald Court Gown');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Emerald Court Gown' }));
    await userEvent.type(screen.getByLabelText('Discount %'), '20');
    await userEvent.click(screen.getByRole('button', { name: 'Put on sale' }));
    await confirmInDialog('Put on sale');

    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toMatch(/\/api\/admin\/products\/bulk-update$/);
    expect(post?.body).toEqual({ ids: ['p1'], action: { type: 'sale', discountPct: 20 } });

    expect(await screen.findByText('1 on sale')).toBeInTheDocument();
    // The refetched row shows list price struck through beside the sale price.
    expect(await screen.findByText('₹1,47,200')).toBeInTheDocument();
    expect(screen.getByText('−20%')).toBeInTheDocument();
    expect(screen.getAllByText('Sale').length).toBeGreaterThan(0);
  });

  it('ends a sale, changes visibility and sets a flag on the selection', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/products/bulk-update') && init?.method === 'POST') {
        return { json: { results: [{ id: 'p1', outcome: 'updated' }, { id: 'p2', outcome: 'skipped' }] } };
      }
      if (url.endsWith('/api/admin/products')) return { json: [P1, P2] };
      return undefined;
    });

    renderApp('/products');
    await screen.findByText('Emerald Court Gown');

    const selectAll = () => userEvent.click(screen.getByRole('checkbox', { name: 'Select all pieces' }));

    await selectAll();
    await userEvent.click(screen.getByRole('button', { name: 'End sale' }));
    await confirmInDialog('End sale');
    // Pieces the action didn't apply to are reported, not silently dropped.
    expect(await screen.findByText('1 back to full price · 1 unchanged')).toBeInTheDocument();

    await selectAll();
    await userEvent.click(screen.getByRole('button', { name: 'Hide' }));
    await confirmInDialog('Hide');
    await screen.findByText('1 hidden · 1 unchanged');

    await selectAll();
    await userEvent.selectOptions(screen.getByLabelText('Set flag'), 'new');
    await userEvent.click(screen.getByRole('button', { name: 'Apply flag' }));
    await confirmInDialog('Apply flag');
    await screen.findByText('1 flagged · 1 unchanged');

    const bodies = calls.filter((c) => c.method === 'POST').map((c) => c.body);
    expect(bodies).toEqual([
      { ids: ['p1', 'p2'], action: { type: 'end_sale' } },
      { ids: ['p1', 'p2'], action: { type: 'visibility', active: false } },
      { ids: ['p1', 'p2'], action: { type: 'flag', flag: 'new' } },
    ]);
  });

  it('selects pieces and bulk-deletes them, reporting archive fallbacks', async () => {
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

    // Selecting rows reveals the bulk action bar.
    await userEvent.click(screen.getByRole('checkbox', { name: 'Select all pieces' }));
    expect(screen.getByText('2 selected')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Delete' }));

    // The confirm modal names every piece about to go before anything fires.
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Emerald Court Gown')).toBeInTheDocument();
    expect(within(dialog).getByText('Rang Mehfil Lehenga')).toBeInTheDocument();
    await userEvent.click(within(dialog).getByRole('button', { name: 'Delete 2 pieces' }));

    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toMatch(/\/api\/admin\/products\/bulk-delete$/);
    expect(post?.body).toEqual({ ids: ['p1', 'p2'] });

    // Deleted and archived rows both leave the list; the toast reports the split.
    expect(await screen.findByText('1 deleted · 1 archived (has orders)')).toBeInTheDocument();
    expect(screen.queryByText('Emerald Court Gown')).not.toBeInTheDocument();
    expect(screen.queryByText('Rang Mehfil Lehenga')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'New Piece' })).toBeInTheDocument();
  });

  it('row checkboxes do not open the editor', async () => {
    seedAdminAuth();
    mockFetch(catalogOnly);

    renderApp('/products');
    await screen.findByText('Emerald Court Gown');

    await userEvent.click(screen.getByRole('checkbox', { name: 'Select Emerald Court Gown' }));
    // Still on the list (the editor page would swap the heading).
    expect(screen.getByRole('heading', { name: 'Products' })).toBeInTheDocument();
    expect(screen.getByText('1 selected')).toBeInTheDocument();
  });
});
