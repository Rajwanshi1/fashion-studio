import type { Order } from '../types';

export interface DeliveryTotals {
  /** SUM(balance) still to collect across the shown orders, paise. */
  pendingToCollect: number;
  collectedCash: number;
  collectedOnline: number;
}

/** Money rollups for the delivery board — over exactly the orders shown. */
export function deliveryTotals(orders: Order[]): DeliveryTotals {
  const totals: DeliveryTotals = { pendingToCollect: 0, collectedCash: 0, collectedOnline: 0 };
  for (const order of orders) {
    totals.pendingToCollect += Math.max(0, order.balance);
    for (const receipt of order.receipts) {
      if (receipt.mode === 'cash') totals.collectedCash += receipt.amount;
      else totals.collectedOnline += receipt.amount;
    }
  }
  return totals;
}
