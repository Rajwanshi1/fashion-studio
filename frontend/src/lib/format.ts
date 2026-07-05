/** Format integer paise as Indian rupees: 18400000 → '₹1,84,000'.
 *  Whole rupees — no decimals shown for .00 amounts. */
export function formatINR(paise: number): string {
  const rupees = paise / 100;
  return '₹' + rupees.toLocaleString('en-IN', { maximumFractionDigits: 2 });
}
