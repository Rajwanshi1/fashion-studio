// Shared @hono/zod-validator hook: the API contract requires validation errors
// as { error: string } with status 400 (zod-validator's default leaks the raw
// ZodError shape).

/**
 * Schema paths the operator actually sees, mapped to the words on their
 * screen. Anything unlisted falls back to a de-camelled last path segment —
 * never the raw dotted path (`customer.email: Invalid email` reads as a bug).
 */
const FIELD_LABELS: Record<string, string> = {
  'customer.email': 'Email',
  'customer.phone': 'Mobile number',
  'customer.firstName': 'Customer first name',
  'customer.lastName': 'Customer last name',
  billNumber: 'Bill number',
  billType: 'Bill type',
  deliveryDueDate: 'Delivery due date',
  gstAmount: 'GST amount',
  total: 'Bill total',
  price: 'Price',
  salePrice: 'Sale price',
  costPrice: 'Cost price',
  receivedAt: 'Payment date',
  amount: 'Amount',
};

function labelFor(path: (string | number)[]): string {
  const joined = path.filter((seg) => typeof seg === 'string').join('.');
  if (FIELD_LABELS[joined]) return FIELD_LABELS[joined];
  const last = [...path].reverse().find((seg) => typeof seg === 'string');
  if (last === undefined) return 'This request';
  const spaced = String(last).replace(/([a-z])([A-Z])/g, '$1 $2').toLowerCase();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function humanize(issue: { code?: string; path?: (string | number)[]; message?: string }): string {
  const label = labelFor(issue.path ?? []);
  const message = issue.message ?? 'is invalid';
  // Custom refinements carry copy written for humans — pass it through.
  if (issue.code === 'custom') return message;
  if (message === 'Required') return `${label} is required`;
  if (/at least 1 character/i.test(message)) return `${label} is required`;
  if (/^invalid email$/i.test(message)) return 'Enter a valid email address, or leave it blank';
  return `${label}: ${message}`;
}

export function zodHook(result: any, c: any): any {
  if (!result.success) {
    const issue = result.error?.issues?.[0];
    return c.json({ error: issue ? humanize(issue) : 'Invalid request' }, 400);
  }
}
