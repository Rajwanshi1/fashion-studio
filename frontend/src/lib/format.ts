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
