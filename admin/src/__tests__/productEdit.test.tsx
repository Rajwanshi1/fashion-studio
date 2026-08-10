import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';
import { uploadProductImage } from '../lib/uploads';

// prepareImage needs canvas/createImageBitmap, which jsdom lacks — the upload
// pipeline itself is covered by uploads.test.ts.
vi.mock('../lib/uploads', () => ({
  uploadProductImage: vi.fn(async () => ({
    publicUrl: 'https://fashion-uploads.s3.ap-south-1.amazonaws.com/products/2026/07/abc.jpg',
    pose: 'front',
  })),
}));

const UPLOADED_URL = 'https://fashion-uploads.s3.ap-south-1.amazonaws.com/products/2026/07/abc.jpg';

const CATEGORIES = [
  { id: 'c1', slug: 'gowns', name: 'Gowns', description: '', position: 1 },
  { id: 'c2', slug: 'anarkali', name: 'Anarkali', description: '', position: 2 },
];

type ProductFixture = Record<string, unknown>;

function makeProduct(overrides: ProductFixture = {}): ProductFixture {
  return {
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
    collection: 'The Verdant Edit',
    craft: 'Zardozi',
    fabric: 'Silk',
    occasion: 'Wedding',
    dupattaPrice: 1200000,
    jacketPrice: null,
    colorFamily: 'green',
    salePrice: null,
    costPrice: null,
    images: [],
    active: true,
    variants: [
      { id: 'v1', productId: 'p1', size: 'S', stock: 3 },
      { id: 'v2', productId: 'p1', size: 'M', stock: 4 },
    ],
    ...overrides,
  };
}

/** Renders the edit page for one product with the usual routes stubbed. */
function renderEdit(product: ProductFixture) {
  const id = product.id as string;
  const { calls } = mockFetch((url, init) => {
    if (url.endsWith('/api/categories')) return { json: CATEGORIES };
    if (url.endsWith(`/api/admin/products/${id}`) && init?.method === 'PUT') return { json: product };
    if (url.includes('/api/admin/variants/')) return { json: {} };
    if (url.endsWith('/api/admin/products')) return { json: [product] };
    return undefined;
  });
  renderApp(`/products/${id}`);
  return calls;
}

interface PutBody {
  images: { url: string; pose: string }[];
  fabric: string;
  costPrice: number | null;
  salePrice: number | null;
}

describe('ProductEdit', () => {
  it('posts categorySlug, chip selections and pasted photos for a new piece — never a slug', async () => {
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

    // wait for categories to load into the chip row
    await screen.findByRole('button', { name: /Gowns/ });

    await userEvent.type(screen.getByLabelText('Name'), 'Emerald Court Gown');
    await userEvent.click(screen.getByRole('button', { name: /Gowns/ }));
    await userEvent.type(screen.getByLabelText('Price (₹ rupees)'), '184000');
    await userEvent.type(screen.getByLabelText('Color'), 'Emerald');
    await userEvent.type(screen.getByLabelText('Collection'), 'The Verdant Edit');
    await userEvent.type(screen.getByLabelText('Craft / Work'), 'Zardozi');
    await userEvent.click(screen.getByRole('button', { name: 'Silk' }));
    await userEvent.type(screen.getByLabelText('Occasion'), 'Wedding');
    await userEvent.type(
      screen.getByLabelText('Dupatta price (₹ — blank if no dupatta, 0 if included free)'),
      '12000',
    );
    await userEvent.type(
      screen.getByLabelText('Cost price (₹ — admin only, never shown in the boutique)'),
      '5000',
    );
    // paste-URL escape hatch
    await userEvent.type(
      screen.getByLabelText('Image URL (or paste one directly)'),
      'https://cdn.example/pasted.jpg',
    );
    await userEvent.click(screen.getByRole('button', { name: 'Add photo URL' }));
    await userEvent.clear(screen.getByLabelText('M'));
    await userEvent.type(screen.getByLabelText('M'), '4');
    await userEvent.click(screen.getByRole('button', { name: 'Add Piece' }));

    const post = calls.find((c) => c.method === 'POST');
    expect(post).toBeDefined();
    expect(post?.url).toMatch(/\/api\/admin\/products$/);

    const body = post?.body as {
      name: string;
      categorySlug: string;
      price: number;
      flag: string | null;
      salePrice: number | null;
      costPrice: number | null;
      images: { url: string; pose: string }[];
      active: boolean;
      collection: string;
      craft: string;
      fabric: string;
      occasion: string;
      dupattaPrice: number | null;
      jacketPrice: number | null;
      variants: { size: string; stock: number }[];
    };
    // the slug is derived server-side now — the form must not send one
    expect(body).not.toHaveProperty('slug');
    expect(body).not.toHaveProperty('imageUrl');
    expect(body).not.toHaveProperty('categoryId');
    expect(body.categorySlug).toBe('gowns');
    // rupees → paise
    expect(body.price).toBe(18400000);
    expect(body.name).toBe('Emerald Court Gown');
    expect(body.flag).toBeNull();
    expect(body.salePrice).toBeNull();
    expect(body.costPrice).toBe(500000);
    expect(body.images).toEqual([{ url: 'https://cdn.example/pasted.jpg', pose: '' }]);
    expect(body.active).toBe(true);
    expect(body.collection).toBe('The Verdant Edit');
    expect(body.craft).toBe('Zardozi');
    expect(body.fabric).toBe('Silk');
    expect(body.occasion).toBe('Wedding');
    expect(body.dupattaPrice).toBe(1200000); // rupees → paise
    expect(body.jacketPrice).toBeNull(); // blank = no jacket in the set
    expect(body.variants).toHaveLength(6);
    expect(body.variants.map((v) => v.size)).toEqual(['XS', 'S', 'M', 'L', 'XL', 'Custom']);
    expect(body.variants.find((v) => v.size === 'M')?.stock).toBe(4);

    // saved → back on the products list
    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument();
  });

  it('PUTs the piece and PATCHes only changed variants when editing', async () => {
    seedAdminAuth();
    const calls = renderEdit(makeProduct());

    const mInput = await screen.findByLabelText('M');
    await userEvent.clear(mInput);
    await userEvent.type(mInput, '9');
    await userEvent.click(screen.getByRole('button', { name: 'Save Piece' }));

    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toBeDefined();
    expect(put?.url).toMatch(/\/api\/admin\/products\/p1$/);
    const body = put?.body as PutBody & { price: number; categorySlug: string };
    expect(body.price).toBe(18400000);
    // the category comes straight off the product — no id resolution dance
    expect(body.categorySlug).toBe('gowns');
    expect(body).not.toHaveProperty('slug');
    expect(body.costPrice).toBeNull(); // untouched blank stays null

    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].url).toMatch(/\/api\/admin\/variants\/v2$/);
    expect(patches[0].body).toEqual({ stock: 9 });

    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument();
  });

  it('links the discount percentage and the sale price in both directions', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/categories')) return { json: CATEGORIES };
      if (url.endsWith('/api/admin/products') && init?.method === 'POST') return { json: { id: 'p' } };
      if (url.endsWith('/api/admin/products')) return { json: [] };
      return undefined;
    });

    renderApp('/products/new');
    await screen.findByRole('button', { name: /Gowns/ });

    await userEvent.type(screen.getByLabelText('Name'), 'Sale Gown');
    await userEvent.click(screen.getByRole('button', { name: /Gowns/ }));
    await userEvent.type(screen.getByLabelText('Price (₹ rupees)'), '10000');
    await userEvent.click(screen.getByRole('button', { name: /Sale/ }));

    // % → ₹
    await userEvent.type(screen.getByLabelText('Discount (%)'), '25');
    expect(screen.getByLabelText('Sale price (₹ rupees)')).toHaveValue(7500);

    // ₹ → %
    await userEvent.clear(screen.getByLabelText('Sale price (₹ rupees)'));
    await userEvent.type(screen.getByLabelText('Sale price (₹ rupees)'), '6000');
    expect(screen.getByLabelText('Discount (%)')).toHaveValue(40);

    // editing the base price re-derives the % — the sale price is authoritative
    await userEvent.clear(screen.getByLabelText('Price (₹ rupees)'));
    await userEvent.type(screen.getByLabelText('Price (₹ rupees)'), '12000');
    expect(screen.getByLabelText('Sale price (₹ rupees)')).toHaveValue(6000);
    expect(screen.getByLabelText('Discount (%)')).toHaveValue(50);

    await userEvent.click(screen.getByRole('button', { name: 'Add Piece' }));
    const body = calls.find((c) => c.method === 'POST')?.body as {
      flag: string;
      price: number;
      salePrice: number;
    };
    expect(body.flag).toBe('sale');
    expect(body.price).toBe(1200000);
    expect(body.salePrice).toBe(600000);
  });

  it('blocks the save while the sale price is not below the regular price', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url) => {
      if (url.endsWith('/api/categories')) return { json: CATEGORIES };
      if (url.endsWith('/api/admin/products')) return { json: [] };
      return undefined;
    });

    renderApp('/products/new');
    await screen.findByRole('button', { name: /Gowns/ });

    await userEvent.type(screen.getByLabelText('Name'), 'Sale Gown');
    await userEvent.click(screen.getByRole('button', { name: /Gowns/ }));
    await userEvent.type(screen.getByLabelText('Price (₹ rupees)'), '10000');
    await userEvent.click(screen.getByRole('button', { name: /Sale/ }));
    await userEvent.type(screen.getByLabelText('Sale price (₹ rupees)'), '12000');

    expect(screen.getByText('Sale price must be below the regular price')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Add Piece' }));
    expect(calls.find((c) => c.method === 'POST')).toBeUndefined();
    expect(screen.getByRole('heading', { name: 'New Piece' })).toBeInTheDocument();
  });

  it('loads a saved sale into the linked pair', async () => {
    seedAdminAuth();
    const calls = renderEdit(makeProduct({ flag: 'sale', price: 1000000, salePrice: 750000 }));

    await waitFor(() => expect(screen.getByLabelText('Discount (%)')).toHaveValue(25));
    expect(screen.getByLabelText('Sale price (₹ rupees)')).toHaveValue(7500);

    await userEvent.click(screen.getByRole('button', { name: 'Save Piece' }));
    const body = calls.find((c) => c.method === 'PUT')?.body as PutBody;
    expect(body.salePrice).toBe(750000);
  });

  it('clears the sale price when the flag moves off Sale', async () => {
    seedAdminAuth();
    const calls = renderEdit(makeProduct({ flag: 'sale', price: 1000000, salePrice: 750000 }));

    await screen.findByLabelText('Sale price (₹ rupees)');
    await userEvent.click(screen.getByRole('button', { name: /Bestseller/ }));
    expect(screen.queryByLabelText('Sale price (₹ rupees)')).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save Piece' }));
    const body = calls.find((c) => c.method === 'PUT')?.body as PutBody & { flag: string };
    expect(body.flag).toBe('bestseller');
    expect(body.salePrice).toBeNull();
  });

  it('shows a legacy fabric as its own chip and still lets Silk be chosen', async () => {
    seedAdminAuth();
    const calls = renderEdit(makeProduct({ fabric: 'Tissue' }));

    const legacy = await screen.findByRole('button', { name: 'Tissue' });
    expect(legacy).toHaveClass('chip', 'on');

    await userEvent.click(screen.getByRole('button', { name: 'Silk' }));
    expect(screen.queryByRole('button', { name: 'Tissue' })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Save Piece' }));
    expect((calls.find((c) => c.method === 'PUT')?.body as PutBody).fabric).toBe('Silk');
  });

  it('clicking the active fabric chip clears the fabric', async () => {
    seedAdminAuth();
    const calls = renderEdit(makeProduct({ fabric: 'Silk' }));

    await userEvent.click(await screen.findByRole('button', { name: 'Silk' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save Piece' }));
    expect((calls.find((c) => c.method === 'PUT')?.body as PutBody).fabric).toBe('');
  });

  it('reorders and removes gallery photos, saving them in display order', async () => {
    seedAdminAuth();
    const calls = renderEdit(
      makeProduct({
        imageUrl: 'https://cdn.example/a.jpg',
        images: [
          { url: 'https://cdn.example/a.jpg', pose: 'front' },
          { url: 'https://cdn.example/b.jpg', pose: 'back' },
          { url: 'https://cdn.example/c.jpg', pose: '' },
        ],
      }),
    );

    await screen.findByAltText('Product photo 1 — front');
    // the old arrow buttons are gone — reorder is drag-and-drop with a keyboard path
    expect(screen.queryByRole('button', { name: 'Move image 1 up' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Move image 1 down' })).not.toBeInTheDocument();

    // arrow keys on a focused grip move the photo one slot; focus follows it
    screen.getByRole('button', { name: 'Reorder image 1 of 3' }).focus();
    await userEvent.keyboard('{ArrowRight}');
    expect(screen.getByRole('button', { name: 'Reorder image 2 of 3' })).toHaveFocus();
    expect(screen.getByText('Photo moved to position 2 of 3')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Remove image 3' }));
    await userEvent.click(screen.getByRole('button', { name: 'Save Piece' }));

    const body = calls.find((c) => c.method === 'PUT')?.body as PutBody;
    expect(body.images).toEqual([
      { url: 'https://cdn.example/b.jpg', pose: 'back' },
      { url: 'https://cdn.example/a.jpg', pose: 'front' },
    ]);
  });

  it('falls back to the legacy imageUrl when the gallery is empty', async () => {
    seedAdminAuth();
    const calls = renderEdit(makeProduct({ imageUrl: 'https://cdn.example/legacy.jpg', images: [] }));

    await screen.findByAltText('Product photo 1');
    await userEvent.click(screen.getByRole('button', { name: 'Save Piece' }));

    const body = calls.find((c) => c.method === 'PUT')?.body as PutBody;
    expect(body.images).toEqual([{ url: 'https://cdn.example/legacy.jpg', pose: '' }]);
  });

  it('uploads picked photos one at a time and appends them to the gallery', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/categories')) return { json: CATEGORIES };
      if (url.endsWith('/api/admin/products') && init?.method === 'POST') return { json: { id: 'p' } };
      if (url.endsWith('/api/admin/products')) return { json: [] };
      return undefined;
    });

    renderApp('/products/new');
    await screen.findByRole('button', { name: /Gowns/ });

    await userEvent.type(screen.getByLabelText('Name'), 'Emerald Court Gown');
    await userEvent.click(screen.getByRole('button', { name: /Gowns/ }));
    await userEvent.type(screen.getByLabelText('Price (₹ rupees)'), '184000');

    const files = [
      new File([new Uint8Array([1])], 'front.jpg', { type: 'image/jpeg' }),
      new File([new Uint8Array([2])], 'back.jpg', { type: 'image/jpeg' }),
    ];
    await userEvent.upload(screen.getByLabelText('Product photo file'), files);

    // the product name rides along so the server can name the object after it
    expect(uploadProductImage).toHaveBeenNthCalledWith(1, files[0], 'Emerald Court Gown');
    expect(uploadProductImage).toHaveBeenNthCalledWith(2, files[1], 'Emerald Court Gown');
    await waitFor(() => expect(screen.getAllByAltText(/Product photo \d — front/)).toHaveLength(2));

    await userEvent.click(screen.getByRole('button', { name: 'Add Piece' }));
    const body = calls.find((c) => c.method === 'POST')?.body as PutBody;
    expect(body.images).toEqual([
      { url: UPLOADED_URL, pose: 'front' },
      { url: UPLOADED_URL, pose: 'front' },
    ]);
  });
});
