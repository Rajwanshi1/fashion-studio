/** Identical to the storefront: paise → '₹1,84,000' (en-IN grouping). */
export function formatINR(paise: number): string {
  return '₹' + (paise / 100).toLocaleString('en-IN');
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}
