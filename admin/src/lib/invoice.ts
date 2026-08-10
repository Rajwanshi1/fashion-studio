import { api, API_URL, storedToken } from './api';
import type { Order } from './types';

// Bypasses the JSON client deliberately: the response is a PDF download.
export async function downloadInvoicePdf(order: Order): Promise<void> {
  const res = await fetch(`${API_URL}/api/admin/orders/${order.id}/invoice.pdf`, {
    headers: { Authorization: `Bearer ${storedToken() ?? ''}` },
  });
  if (!res.ok) throw new Error('Unable to download invoice');
  const url = URL.createObjectURL(await res.blob());
  const a = document.createElement('a');
  a.href = url;
  a.download = `${order.orderNumber}.pdf`;
  a.click();
  URL.revokeObjectURL(url);
}

/** Server renders + WhatsApps the PDF; resolves to the order with invoiceSentAt stamped. */
export function sendInvoice(orderId: string): Promise<Order> {
  return api<Order>(`/api/admin/orders/${orderId}/invoice/send`, { method: 'POST' });
}
