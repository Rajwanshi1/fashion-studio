import {
  EMPTY_FILTERS,
  FABRIC_UNSET,
  applyProductFilters,
  categoryOptions,
  effectivePrice,
  fabricOptions,
  hasActiveFilters,
} from '../lib/productFilter';
import type { ProductFilters } from '../lib/productFilter';
import type { AdminProduct } from '../lib/types';

function product(over: Partial<AdminProduct> = {}): AdminProduct {
  return {
    id: 'p',
    slug: 'p',
    name: 'Piece',
    price: 10000000, // ₹1,00,000
    color: 'Sage',
    flag: null,
    imageUrl: null,
    categorySlug: 'gowns',
    categoryName: 'Gowns',
    description: '',
    details: '',
    collection: '',
    craft: '',
    fabric: 'Silk',
    occasion: '',
    dupattaPrice: null,
    jacketPrice: null,
    colorFamily: null,
    salePrice: null,
    costPrice: null,
    images: [],
    active: true,
    variants: [],
    karigarName: '',
    hoursWorked: null,
    techniques: '',
    finishedOn: null,
    ...over,
  };
}

const filters = (over: Partial<ProductFilters> = {}): ProductFilters => ({ ...EMPTY_FILTERS, ...over });

const slugs = (rows: AdminProduct[]) => rows.map((p) => p.slug);

describe('effectivePrice', () => {
  it('is the list price unless the piece is on sale', () => {
    expect(effectivePrice(product({ price: 500000 }))).toBe(500000);
    expect(effectivePrice(product({ price: 500000, salePrice: 400000 }))).toBe(500000);
    expect(effectivePrice(product({ price: 500000, flag: 'sale', salePrice: 400000 }))).toBe(400000);
  });

  it('falls back to the list price when a sale flag has no price behind it', () => {
    expect(effectivePrice(product({ price: 500000, flag: 'sale', salePrice: null }))).toBe(500000);
  });
});

describe('applyProductFilters', () => {
  const rows = [
    product({ slug: 'a', categorySlug: 'gowns', fabric: 'Silk', flag: 'new', price: 5000000 }),
    product({ slug: 'b', categorySlug: 'lehenga', fabric: 'Chanderi', flag: null, price: 15000000 }),
    product({ slug: 'c', categorySlug: 'gowns', fabric: '', flag: 'sale', price: 20000000, salePrice: 8000000, active: false }),
  ];

  it('returns everything when nothing is set', () => {
    expect(applyProductFilters(rows, EMPTY_FILTERS)).toHaveLength(3);
    expect(hasActiveFilters(EMPTY_FILTERS)).toBe(false);
  });

  it('filters by category', () => {
    expect(slugs(applyProductFilters(rows, filters({ categorySlug: 'gowns' })))).toEqual(['a', 'c']);
  });

  it('filters by fabric, including pieces with none recorded', () => {
    expect(slugs(applyProductFilters(rows, filters({ fabric: 'Chanderi' })))).toEqual(['b']);
    expect(slugs(applyProductFilters(rows, filters({ fabric: FABRIC_UNSET })))).toEqual(['c']);
  });

  it('filters by flag, including unflagged pieces', () => {
    expect(slugs(applyProductFilters(rows, filters({ flag: 'sale' })))).toEqual(['c']);
    expect(slugs(applyProductFilters(rows, filters({ flag: 'none' })))).toEqual(['b']);
  });

  it('filters by visibility', () => {
    expect(slugs(applyProductFilters(rows, filters({ visibility: 'active' })))).toEqual(['a', 'b']);
    expect(slugs(applyProductFilters(rows, filters({ visibility: 'hidden' })))).toEqual(['c']);
  });

  it('filters on the price actually charged, so a sale piece sorts by its sale price', () => {
    // 'c' lists at ₹2,00,000 but sells at ₹80,000 — a ₹1,00,000 ceiling keeps it.
    expect(slugs(applyProductFilters(rows, filters({ maxRupees: '100000' })))).toEqual(['a', 'c']);
    expect(slugs(applyProductFilters(rows, filters({ minRupees: '100000' })))).toEqual(['b']);
    expect(slugs(applyProductFilters(rows, filters({ minRupees: '60000', maxRupees: '90000' })))).toEqual(['c']);
  });

  it('ignores a price bound that is empty or half-typed', () => {
    expect(applyProductFilters(rows, filters({ minRupees: '  ' }))).toHaveLength(3);
    expect(applyProductFilters(rows, filters({ maxRupees: '-' }))).toHaveLength(3);
  });

  it('ANDs every filter together', () => {
    const f = filters({ categorySlug: 'gowns', visibility: 'active', maxRupees: '100000' });
    expect(slugs(applyProductFilters(rows, f))).toEqual(['a']);
    expect(hasActiveFilters(f)).toBe(true);
  });
});

describe('filter options', () => {
  const rows = [
    product({ categorySlug: 'gowns', categoryName: 'Gowns', fabric: 'Silk' }),
    product({ categorySlug: 'lehenga', categoryName: 'Lehenga Sets', fabric: 'Chanderi' }),
    product({ categorySlug: 'gowns', categoryName: 'Gowns', fabric: '  ' }),
  ];

  it('lists each category once, by name', () => {
    expect(categoryOptions(rows)).toEqual([
      { slug: 'gowns', name: 'Gowns' },
      { slug: 'lehenga', name: 'Lehenga Sets' },
    ]);
  });

  it('lists distinct fabrics and drops the blanks', () => {
    expect(fabricOptions(rows)).toEqual(['Chanderi', 'Silk']);
  });
});
