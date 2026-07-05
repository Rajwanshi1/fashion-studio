import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';

const CATEGORIES = [
  { id: 'c1', slug: 'gowns', name: 'Gowns', description: '', position: 1 },
  { id: 'c2', slug: 'anarkali', name: 'Anarkali', description: '', position: 2 },
];

describe('ProductEdit', () => {
  it('converts the rupee price to paise and posts variants for a new piece', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/categories')) return { json: CATEGORIES };
      if (url.endsWith('/api/admin/products') && init?.method === 'POST') {
        return { json: { id: 'p-new' } };
      }
      if (url.endsWith('/api/admin/products')) return { json: [] };
      return undefined;
    });

    renderApp('/products/new');

    // wait for categories to load into the select
    await screen.findByRole('option', { name: 'Gowns' });

    await userEvent.type(screen.getByLabelText('Name'), 'Emerald Court Gown');
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'c1');
    await userEvent.type(screen.getByLabelText('Price (₹ rupees)'), '184000');
    await userEvent.clear(screen.getByLabelText('M'));
    await userEvent.type(screen.getByLabelText('M'), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Add Piece' }));

    const post = calls.find((c) => c.method === 'POST');
    expect(post).toBeDefined();
    expect(post?.url).toMatch(/\/api\/admin\/products$/);

    const body = post?.body as {
      name: string;
      slug: string;
      categoryId: string;
      price: number;
      flag: string | null;
      imageUrl: string | null;
      active: boolean;
      variants: { size: string; stock: number }[];
    };
    // rupees → paise
    expect(body.price).toBe(18400000);
    expect(body.name).toBe('Emerald Court Gown');
    // slug auto-derived from the name
    expect(body.slug).toBe('emerald-court-gown');
    expect(body.categoryId).toBe('c1');
    expect(body.flag).toBeNull();
    expect(body.imageUrl).toBeNull();
    expect(body.active).toBe(true);
    expect(body.variants).toHaveLength(6);
    expect(body.variants.map((v) => v.size)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'Custom']);
    expect(body.variants.find((v) => v.size === 'M')?.stock).toBe(4);

    // saved → back on the products list
    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument();
  });

  it('PUTs the piece and PATCHes only changed variants when editing', async () => {
    seedAdminAuth();
    const product = {
      id: 'p1',
      slug: 'emerald-court-gown',
      name: 'Emerald Court Gown',
      price: 18400000,
      color: 'Emerald',
      flag: 'bestseller',
      imageUrl: null,
      categorySlug: 'gowns',
      categoryName: 'Gowns',
      description: 'A gown.',
      details: 'Silk.',
      active: true,
      variants: [
        { id: 'v1', productId: 'p1', size: 'S', stock: 3 },
        { id: 'v2', productId: 'p1', size: 'M', stock: 4 },
      ],
    };
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/categories')) return { json: CATEGORIES };
      if (url.endsWith('/api/admin/products/p1') && init?.method === 'PUT') {
        return { json: product };
      }
      if (url.endsWith('/api/admin/variants/v2') && init?.method === 'PATCH') {
        return { json: { ...product.variants[1], stock: 9 } };
      }
      if (url.endsWith('/api/admin/products')) return { json: [product] };
      return undefined;
    });

    renderApp('/products/p1');

    const mInput = await screen.findByLabelText('M');
    await userEvent.clear(mInput);
    await userEvent.type(mInput, '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save Piece' }));

    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toBeDefined();
    expect(put?.url).toMatch(/\/api\/admin\/products\/p1$/);
    expect((put?.body as { price: number }).price).toBe(18400000);

    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toMatch(/\/api\/admin\/variants\/v2$/);
    expect(patches[0].body).toEqual({ stock: 9 });

    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument();
  });
});
