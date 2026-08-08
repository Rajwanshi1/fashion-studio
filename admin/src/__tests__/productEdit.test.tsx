import { screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';
import { uploadProductImage } from '../lib/uploads';

// prepareImage needs canvas/createImageBitmap, which jsdom lacks — the upload
// pipeline itself is covered by backend/test/uploads.test.ts.
vi.mock('../lib/uploads', () => ({
  uploadProductImage: vi.fn(async () => ({
    publicUrl: 'https://fashion-uploads.s3.ap-south-1.amazonaws.com/products/2026/07/abc.jpg',
  })),
}));

const CATEGORIES = [
  { id: 'c1', slug: 'gowns', name: 'Gowns', description: '', position: 1 },
  { id: 'c2', slug: 'anarkali', name: 'Anarkali', description: '', position: 2 },
];

/** Pick a tri-state mode inside the dupatta/jacket group (both offer the same options). */
const setAddon = (title: string, option: string) =>
  userEvent.click(
    within(screen.getByRole('radiogroup', { name: `${title} in the set` })).getByRole('radio', {
      name: option,
    }),
  );

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
    await userEvent.type(screen.getByLabelText('Color'), 'Emerald');
    await userEvent.type(screen.getByLabelText('Collection'), 'The Verdant Edit');
    await userEvent.type(screen.getByLabelText('Craft / Work'), 'Zardozi');
    await userEvent.type(screen.getByLabelText('Fabric'), 'Silk');
    await userEvent.type(screen.getByLabelText('Occasion'), 'Wedding');
    await setAddon('Dupatta', 'Priced');
    await userEvent.type(screen.getByLabelText('Dupatta price (₹)'), '12000');
    // Stock steppers: four taps on + instead of typing.
    for (let i = 0; i < 4; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Increase M stock' }));
    }
    expect(screen.getByLabelText('M')).toHaveValue('4');
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
      collection: string;
      craft: string;
      fabric: string;
      occasion: string;
      dupattaPrice: number | null;
      jacketPrice: number | null;
      variants: { size: string; stock: number }[];
    };
    // rupees → paise
    expect(body.price).toBe(18400000);
    expect(body.name).toBe('Emerald Court Gown');
    // slug auto-derived from name + colour
    expect(body.slug).toBe('emerald-court-gown-emerald');
    expect(body.categoryId).toBe('c1');
    expect(body.flag).toBeNull();
    expect(body.imageUrl).toBeNull();
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
      collection: 'The Verdant Edit',
      craft: 'Zardozi',
      fabric: 'Silk',
      occasion: 'Wedding',
      dupattaPrice: 1200000,
      jacketPrice: null,
      active: true,
      variants: [
        { id: 'v1', productId: 'p1', size: 'S', stock: 3 },
        { id: 'v2', productId: 'p1', size: 'M', stock: 4 },
        { id: 'v3', productId: 'p1', size: 'L', stock: 1 },
      ],
    };
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/categories')) return { json: CATEGORIES };
      if (url.endsWith('/api/admin/products/p1') && init?.method === 'PUT') {
        return { json: product };
      }
      if (url.includes('/api/admin/variants/') && init?.method === 'PATCH') {
        return { json: product.variants[0] };
      }
      if (url.endsWith('/api/admin/products')) return { json: [product] };
      return undefined;
    });

    renderApp('/products/p1');

    // The stored add-on price opens in "Priced" with the rupee amount filled in.
    await screen.findByLabelText('M');
    const dupatta = screen.getByRole('radiogroup', { name: 'Dupatta in the set' });
    expect(within(dupatta).getByRole('radio', { name: 'Priced' })).toBeChecked();
    expect(screen.getByLabelText('Dupatta price (₹)')).toHaveValue(12000);
    expect(
      within(screen.getByRole('radiogroup', { name: 'Jacket in the set' })).getByRole('radio', {
        name: 'Not in set',
      }),
    ).toBeChecked();

    // S 3 → 2, M 4 → 9, L untouched.
    await userEvent.click(screen.getByRole('button', { name: 'Decrease S stock' }));
    for (let i = 0; i < 5; i += 1) {
      await userEvent.click(screen.getByRole('button', { name: 'Increase M stock' }));
    }
    await userEvent.click(screen.getByRole('button', { name: 'Save Piece' }));

    const put = calls.find((c) => c.method === 'PUT');
    expect(put).toBeDefined();
    expect(put?.url).toMatch(/\/api\/admin\/products\/p1$/);
    expect((put?.body as { price: number }).price).toBe(18400000);
    expect((put?.body as { dupattaPrice: number | null }).dupattaPrice).toBe(1200000);

    // Only the two edited variants are PATCHed, and they go out together.
    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(2);
    expect(patches.map((p) => p.url.replace(/^.*\/variants\//, ''))).toEqual(['v1', 'v2']);
    expect(patches.map((p) => p.body)).toEqual([{ stock: 2 }, { stock: 9 }]);

    expect(await screen.findByRole('heading', { name: 'Products' })).toBeInTheDocument();
    // Stored slug differs from deriveSlug(name, color), so it was kept as-is.
    expect((put?.body as { slug: string }).slug).toBe('emerald-court-gown');
  });

  it('keeps auto-deriving the slug on edit while it matches name + colour', async () => {
    seedAdminAuth();
    const product = {
      id: 'p2',
      slug: 'moss-drape-kaftan-moss', // matches deriveSlug('Moss Drape Kaftan', 'Moss')
      name: 'Moss Drape Kaftan',
      price: 9600000,
      color: 'Moss',
      flag: null,
      imageUrl: null,
      categorySlug: 'gowns',
      categoryName: 'Gowns',
      description: '',
      details: '',
      collection: '',
      craft: '',
      fabric: '',
      occasion: '',
      dupattaPrice: null,
      jacketPrice: null,
      active: true,
      variants: [{ id: 'v9', productId: 'p2', size: 'M', stock: 2 }],
    };
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/categories')) return { json: CATEGORIES };
      if (url.endsWith('/api/admin/products/p2') && init?.method === 'PUT') return { json: product };
      if (url.endsWith('/api/admin/products')) return { json: [product] };
      return undefined;
    });

    renderApp('/products/p2');

    const colorInput = await screen.findByLabelText('Color');
    await userEvent.clear(colorInput);
    await userEvent.type(colorInput, 'Fern');
    await userEvent.click(screen.getByRole('button', { name: 'Save Piece' }));

    const put = calls.find((c) => c.method === 'PUT');
    expect((put?.body as { slug: string }).slug).toBe('moss-drape-kaftan-fern');
  });

  it('maps the tri-states and the flag onto the saved payload', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/categories')) return { json: CATEGORIES };
      if (url.endsWith('/api/admin/products') && init?.method === 'POST') return { json: { id: 'p' } };
      if (url.endsWith('/api/admin/products')) return { json: [] };
      return undefined;
    });

    renderApp('/products/new');
    await screen.findByRole('option', { name: 'Gowns' });

    await userEvent.type(screen.getByLabelText('Name'), 'Moss Drape Kaftan');
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'c1');
    await userEvent.type(screen.getByLabelText('Price (₹ rupees)'), '96000');

    await userEvent.click(screen.getByRole('radio', { name: 'Bestseller' }));
    // Included free is the literal 0 the API expects; the ₹ field stays hidden.
    await setAddon('Dupatta', 'Included free');
    expect(screen.queryByLabelText('Dupatta price (₹)')).not.toBeInTheDocument();
    await setAddon('Jacket', 'Priced');
    await userEvent.type(screen.getByLabelText('Jacket price (₹)'), '800');

    await userEvent.click(screen.getByRole('button', { name: 'Add Piece' }));

    const body = calls.find((c) => c.method === 'POST')?.body as {
      flag: string | null;
      dupattaPrice: number | null;
      jacketPrice: number | null;
    };
    expect(body.flag).toBe('bestseller');
    expect(body.dupattaPrice).toBe(0);
    expect(body.jacketPrice).toBe(80000);
  });

  it('refuses to save a Priced add-on with no amount typed', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/categories')) return { json: CATEGORIES };
      if (url.endsWith('/api/admin/products') && init?.method === 'POST') return { json: { id: 'p' } };
      if (url.endsWith('/api/admin/products')) return { json: [] };
      return undefined;
    });

    renderApp('/products/new');
    await screen.findByRole('option', { name: 'Gowns' });

    await userEvent.type(screen.getByLabelText('Name'), 'Moss Drape Kaftan');
    await userEvent.selectOptions(screen.getByLabelText('Category'), 'c1');
    await userEvent.type(screen.getByLabelText('Price (₹ rupees)'), '96000');
    await setAddon('Dupatta', 'Priced');
    await userEvent.click(screen.getByRole('button', { name: 'Add Piece' }));

    // A blank "Priced" is incomplete, not "no dupatta in the set".
    expect(await screen.findByRole('alert')).toHaveTextContent(/marked Priced/);
    expect(calls.filter((c) => c.method === 'POST')).toHaveLength(0);

    // Filling it in saves the amount.
    await userEvent.type(screen.getByLabelText('Dupatta price (₹)'), '1500');
    await userEvent.click(screen.getByRole('button', { name: 'Add Piece' }));
    const body = calls.find((c) => c.method === 'POST')?.body as { dupattaPrice: number | null };
    expect(body.dupattaPrice).toBe(150000);
  });

  it('uploading a photo fills the image URL with the permanent public URL', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/categories')) return { json: CATEGORIES };
      if (url.endsWith('/api/admin/products')) return { json: [] };
      return undefined;
    });

    renderApp('/products/new');
    await screen.findByRole('option', { name: 'Gowns' });

    const file = new File([new Uint8Array([1, 2, 3])], 'shot.jpg', { type: 'image/jpeg' });
    await userEvent.upload(screen.getByLabelText('Product photo file'), file);

    expect(uploadProductImage).toHaveBeenCalledWith(file);
    await waitFor(() =>
      expect(screen.getByLabelText('Image URL (or paste one directly)')).toHaveValue(
        'https://fashion-uploads.s3.ap-south-1.amazonaws.com/products/2026/07/abc.jpg',
      ),
    );
    // Preview thumb renders from the new URL.
    expect(screen.getByAltText('Product photo preview')).toBeInTheDocument();
  });
});
