import type { AdminProduct } from './types';

/** The flag filter, as a select value: a real flag, 'none', or '' for any. */
export type FlagFilter = 'bestseller' | 'new' | 'sale' | 'none' | '';

/**
 * Every filter the products table offers, all optional and all ANDed together.
 * '' means "any" for the selects; the price bounds are rupee strings straight
 * off the number inputs so a half-typed value never wipes the table.
 */
export interface ProductFilters {
  categorySlug: string;
  /** A fabric name, or 'unset' for pieces with no fabric recorded. */
  fabric: string;
  /** A flag value, or 'none' for pieces carrying no flag. */
  flag: FlagFilter;
  visibility: 'active' | 'hidden' | '';
  minRupees: string;
  maxRupees: string;
}

export const EMPTY_FILTERS: ProductFilters = {
  categorySlug: '',
  fabric: '',
  flag: '',
  visibility: '',
  minRupees: '',
  maxRupees: '',
};

export const FABRIC_UNSET = 'unset';

/**
 * What the piece actually sells for: the sale price when it's on sale, the list
 * price otherwise. Same rule as the backend's EFFECTIVE_PRICE, so filtering by
 * price matches both the column and what a shopper is charged.
 */
export function effectivePrice(p: AdminProduct): number {
  return p.flag === 'sale' && p.salePrice != null ? p.salePrice : p.price;
}

export function hasActiveFilters(f: ProductFilters): boolean {
  return Object.values(f).some((v) => v !== '');
}

/** Rupees typed by the admin → paise, or null when the box is empty/unparseable. */
function paise(rupees: string): number | null {
  const trimmed = rupees.trim();
  if (trimmed === '') return null;
  const value = Number(trimmed);
  return Number.isFinite(value) ? Math.round(value * 100) : null;
}

export function applyProductFilters(products: AdminProduct[], f: ProductFilters): AdminProduct[] {
  const min = paise(f.minRupees);
  const max = paise(f.maxRupees);
  return products.filter((p) => {
    if (f.categorySlug && p.categorySlug !== f.categorySlug) return false;
    if (f.fabric) {
      const fabric = p.fabric?.trim() ?? '';
      if (f.fabric === FABRIC_UNSET ? fabric !== '' : fabric !== f.fabric) return false;
    }
    if (f.flag) {
      if (f.flag === 'none' ? p.flag !== null : p.flag !== f.flag) return false;
    }
    if (f.visibility && p.active !== (f.visibility === 'active')) return false;
    if (min !== null || max !== null) {
      const price = effectivePrice(p);
      if (min !== null && price < min) return false;
      if (max !== null && price > max) return false;
    }
    return true;
  });
}

/** Category options for the filter bar, derived from whatever is loaded. */
export function categoryOptions(products: AdminProduct[]): { slug: string; name: string }[] {
  const bySlug = new Map<string, string>();
  for (const p of products) bySlug.set(p.categorySlug, p.categoryName);
  return [...bySlug].map(([slug, name]) => ({ slug, name })).sort((a, b) => a.name.localeCompare(b.name));
}

/** Distinct non-empty fabrics, sorted. The 'unset' option is added by the UI. */
export function fabricOptions(products: AdminProduct[]): string[] {
  return [...new Set(products.map((p) => p.fabric?.trim() ?? '').filter(Boolean))].sort();
}
