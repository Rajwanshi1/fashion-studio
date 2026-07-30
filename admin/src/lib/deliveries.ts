import type { Order } from './types';

export interface DeliveryBuckets {
  overdue: Order[];
  next7: Order[];
  next14: Order[];
  next21: Order[];
  later: Order[];
}

/** Whole days from `from` to `to`, both YYYY-MM-DD (compared at UTC midnight — no timezone surprises). */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86_400_000);
}

/** Day-granular production buckets. Orders without a due date, delivered or cancelled are skipped. */
export function bucketDeliveries(orders: Order[], today: string): DeliveryBuckets {
  const buckets: DeliveryBuckets = { overdue: [], next7: [], next14: [], next21: [], later: [] };
  for (const order of orders) {
    if (!order.deliveryDueDate || order.status === 'delivered' || order.status === 'cancelled') continue;
    const days = daysBetween(today, order.deliveryDueDate);
    if (days < 0) buckets.overdue.push(order);
    else if (days <= 7) buckets.next7.push(order);
    else if (days <= 14) buckets.next14.push(order);
    else if (days <= 21) buckets.next21.push(order);
    else buckets.later.push(order);
  }
  return buckets;
}

export function relativeDue(today: string, due: string): string {
  const days = daysBetween(today, due);
  if (days === 0) return 'today';
  if (days === 1) return 'tomorrow';
  if (days > 1) return `in ${days} days`;
  return `${-days} day${days === -1 ? '' : 's'} overdue`;
}
