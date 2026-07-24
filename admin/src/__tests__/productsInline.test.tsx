import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';

const product = {
  id: 'p1',
  slug: 'emerald-court-gown',
  name: 'Emerald Court Gown',
  price: 18400000,
  color: 'Emerald',
  flag: null,
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
};

describe('Products inline quick edit', () => {
  it('saves only changed stocks and the active flag, then updates the row', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/products/p1/variants') && init?.method === 'PATCH') {
        return {
          json: {
            ...product,
            variants: [product.variants[0], { ...product.variants[1], stock: 9 }],
          },
        };
      }
      if (url.endsWith('/api/admin/products/p1') && init?.method === 'PUT') {
        return {
          json: {
            ...product,
            active: false,
            variants: [product.variants[0], { ...product.variants[1], stock: 9 }],
          },
        };
      }
      if (url.endsWith('/api/admin/products')) return { json: [product] };
      return undefined;
    });

    renderApp('/products');
    await userEvent.click(await screen.findByText('Emerald Court Gown'));

    const mInput = screen.getByLabelText('M');
    await userEvent.clear(mInput);
    await userEvent.type(mInput, '9');
    await userEvent.click(screen.getByLabelText('Visible in the boutique'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(patch?.url).toMatch(/\/api\/admin\/products\/p1\/variants$/);
    // only the changed variant is sent
    expect(patch?.body).toEqual({ updates: [{ variantId: 'v2', stock: 9 }] });

    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toBeDefined();
    expect(put?.url).toMatch(/\/api\/admin\/products\/p1$/);
    expect(put?.body).toEqual({ active: false });

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    // row reflects the refreshed product: total stock 3 + 9, now hidden
    expect(screen.getByText('12')).toBeInTheDocument();
    expect(screen.getByText('Hidden')).toBeInTheDocument();
  });

  it('skips the PUT when active is untouched', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/products/p1/variants') && init?.method === 'PATCH') {
        return {
          json: {
            ...product,
            variants: [{ ...product.variants[0], stock: 5 }, product.variants[1]],
          },
        };
      }
      if (url.endsWith('/api/admin/products')) return { json: [product] };
      return undefined;
    });

    renderApp('/products');
    await userEvent.click(await screen.findByText('Emerald Court Gown'));

    const sInput = screen.getByLabelText('S');
    await userEvent.clear(sInput);
    await userEvent.type(sInput, '5');
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(await screen.findByText('Saved')).toBeInTheDocument();
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(1);
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);
  });

  it('makes no calls when nothing changed', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url) => {
      if (url.endsWith('/api/admin/products')) return { json: [product] };
      return undefined;
    });

    renderApp('/products');
    await userEvent.click(await screen.findByText('Emerald Court Gown'));
    await userEvent.click(screen.getByRole('button', { name: 'Save' }));

    expect(calls.filter((c) => c.method !== 'GET')).toHaveLength(0);
  });
});
