/** Identical to the storefront: paise → '₹1,84,000' (en-IN grouping). */
export function formatINR(paise: number): string {
  return '₹' + (paise / 100).toLocaleString('en-IN');
}

export function formatDate(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  // Always the boutique's day (IST), not the viewer's — a timestamp rendered
  // in another zone shifts the business date.
  return d.toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

/** Like formatDate but with the time of day — '12 Aug 2026, 6:42 pm' (IST). */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
    timeZone: 'Asia/Kolkata',
  });
}

/** Today's date in the boutique's timezone, YYYY-MM-DD. */
export function todayIST(): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(new Date());
}
