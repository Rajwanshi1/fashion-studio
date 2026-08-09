import { beforeEach, describe, expect, it } from 'vitest';
import { CatalogService, createCatalogService } from '../src/services/catalog.service';
import { FakeProductsRepo, seedCatalog, seedSetProduct } from './fakes';

describe('CatalogService', () => {
  let products: FakeProductsRepo;
  let catalog: CatalogService;
  let seeded: Awaited<ReturnType<typeof seedCatalog>>;

  beforeEach(async () => {
    products = new FakeProductsRepo();
    seeded = await seedCatalog(products);
    catalog = createCatalogService({ products });
  });

  it('lists categories with active product counts, ordered by position', async () => {
    const cats = await catalog.listCategories();
    expect(cats.map((c) => c.slug)).toEqual(['lehenga-sets', 'gowns']);
    expect(cats[0].productCount).toBe(2); // inactive product excluded
    expect(cats[1].productCount).toBe(1);
  });

  it('lists only active products with {items,total,page,pages}', async () => {
    const res = await catalog.listProducts({});
    expect(res.total).toBe(3);
    expect(res.page).toBe(1);
    expect(res.pages).toBe(1);
    expect(res.items.map((p) => p.slug)).not.toContain('archived-lehenga');
  });

  it('defaults to featured sort: bestseller, then new, then the rest', async () => {
    const res = await catalog.listProducts({});
    expect(res.items.map((p) => p.slug)).toEqual([
      'sage-sequin-jacket-lehenga',
      'moss-tissue-draped-gown',
      'celadon-tissue-draped-lehenga',
    ]);
  });

  it('filters by collection and lists distinct collection names', async () => {
    await seedSetProduct(products, seeded.lehengas.id);
    expect(await catalog.listCollections()).toEqual(['The Verdant Edit']);
    const res = await catalog.listProducts({ collection: 'The Verdant Edit' });
    expect(res.items.map((p) => p.slug)).toEqual(['fern-zardozi-set-fern']);
    const blank = await catalog.listProducts({ collection: '   ' }); // whitespace ignored
    expect(blank.total).toBe(4);
  });

  it('filters by category slug', async () => {
    const res = await catalog.listProducts({ category: 'gowns' });
    expect(res.items.map((p) => p.slug)).toEqual(['moss-tissue-draped-gown']);
    expect(res.total).toBe(1);
  });

  it('searches name, description and color case-insensitively', async () => {
    expect((await catalog.listProducts({ search: 'SEQUIN' })).items.map((p) => p.slug)).toEqual([
      'sage-sequin-jacket-lehenga',
    ]);
    expect((await catalog.listProducts({ search: 'single length' })).items.map((p) => p.slug)).toEqual([
      'moss-tissue-draped-gown',
    ]);
    expect((await catalog.listProducts({ search: 'celadon' })).items.map((p) => p.slug)).toEqual([
      'celadon-tissue-draped-lehenga',
    ]);
    expect((await catalog.listProducts({ search: '  ' })).total).toBe(3); // blank search ignored
  });

  it('sorts by price ascending and descending', async () => {
    const asc = await catalog.listProducts({ sort: 'price_asc' });
    expect(asc.items.map((p) => p.price)).toEqual([9600000, 16800000, 18400000]);
    const desc = await catalog.listProducts({ sort: 'price_desc' });
    expect(desc.items.map((p) => p.price)).toEqual([18400000, 16800000, 9600000]);
  });

  it('sorts by newest first for sort=new', async () => {
    const res = await catalog.listProducts({ sort: 'new' });
    expect(res.items.map((p) => p.slug)).toEqual([
      'celadon-tissue-draped-lehenga',
      'moss-tissue-draped-gown',
      'sage-sequin-jacket-lehenga',
    ]);
  });

  it('paginates and clamps page/limit', async () => {
    const page1 = await catalog.listProducts({ limit: 2, page: 1 });
    expect(page1.items).toHaveLength(2);
    expect(page1.pages).toBe(2);
    const page2 = await catalog.listProducts({ limit: 2, page: 2 });
    expect(page2.items).toHaveLength(1);
    expect(page2.page).toBe(2);
    const clamped = await catalog.listProducts({ page: 0, limit: 0 });
    expect(clamped.page).toBe(1);
    expect(clamped.items.length).toBeGreaterThan(0);
  });

  it('returns product detail with variants and related pieces from the same category', async () => {
    const detail = await catalog.getProduct('sage-sequin-jacket-lehenga');
    expect(detail.name).toBe('Sage Sequin Jacket Lehenga');
    expect(detail.variants.map((v) => v.size)).toEqual(['M', 'Custom']);
    expect(detail.related.map((p) => p.slug)).toEqual(['celadon-tissue-draped-lehenga']);
  });

  it('never exposes the admin-only cost price', async () => {
    await products.updateProduct(seeded.sage.id, { costPrice: 5200000 });
    expect((await products.getBySlug('sage-sequin-jacket-lehenga'))!.costPrice).toBe(5200000);
    const detail = await catalog.getProduct('sage-sequin-jacket-lehenga');
    expect(detail).not.toHaveProperty('costPrice');
    expect(detail.price).toBe(18400000);
  });

  it('filters by colour family', async () => {
    await products.updateProduct(seeded.moss.id, { colorFamily: 'pink' });
    const pink = await catalog.listProducts({ color: 'pink' });
    expect(pink.items.map((p) => p.slug)).toEqual(['moss-tissue-draped-gown']);
    expect((await catalog.listProducts({ color: 'green' })).total).toBe(2);
  });

  it('sorts on the sale price when a piece is on sale', async () => {
    // Sage lists highest at 18400000 but is charged 8000000 — it sorts first.
    await products.updateProduct(seeded.sage.id, { flag: 'sale', salePrice: 8000000 });
    const asc = await catalog.listProducts({ sort: 'price_asc' });
    expect(asc.items.map((p) => p.slug)).toEqual([
      'sage-sequin-jacket-lehenga',
      'moss-tissue-draped-gown',
      'celadon-tissue-draped-lehenga',
    ]);
  });

  it('throws NOT_FOUND for unknown or inactive products', async () => {
    await expect(catalog.getProduct('missing')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(catalog.getProduct('archived-lehenga')).rejects.toMatchObject({ code: 'NOT_FOUND' });
  });
});
