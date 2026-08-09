import type { ProductFlag } from './types';

/** Format integer paise as Indian rupees: 18400000 → '₹1,84,000'.
 *  Whole rupees — no decimals shown for .00 amounts. */
export function formatINR(paise: number): string {
  const rupees = paise / 100;
  return '₹' + rupees.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}

/** Full-set price shown on cards and the PDP default: base garment plus the
 *  add-ons that are included by default (dupatta/jacket). */
export function displayPrice(p: { price: number; dupattaPrice: number | null; jacketPrice: number | null }): number {
  return p.price + (p.dupattaPrice ?? 0) + (p.jacketPrice ?? 0);
}

/** Base garment price actually charged: a sale discounts the BASE price only,
 *  never the add-ons. Mirrors the CASE in getVariantsForUpdate, which is what
 *  makes checkout charge the same number the shop shows. */
export function effectiveBasePrice(p: { price: number; flag: ProductFlag; salePrice: number | null }): number {
  return p.flag === 'sale' && p.salePrice !== null ? p.salePrice : p.price;
}

/** Full-set price at the sale price (add-ons at full price), or null when the
 *  piece is not on sale — in which case displayPrice() is the only price shown. */
export function displaySalePrice(p: {
  price: number;
  flag: ProductFlag;
  salePrice: number | null;
  dupattaPrice: number | null;
  jacketPrice: number | null;
}): number | null {
  if (p.flag !== 'sale' || p.salePrice === null) return null;
  return p.salePrice + (p.dupattaPrice ?? 0) + (p.jacketPrice ?? 0);
}
