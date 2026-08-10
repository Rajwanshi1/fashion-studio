import type { OrdersRepo } from '../data/orders.repo';
import { DomainError, Order } from '../types';
import { formatINR, renderInvoicePdf } from './invoice-pdf';
import type { WhatsAppProvider } from './whatsapp.provider';

export interface InvoicesService {
  /** Regenerates the PDF from current order state — nothing is persisted. */
  invoicePdf(orderId: string): Promise<{ pdf: Buffer; filename: string }>;
  /** Renders + WhatsApps the invoice, then stamps invoiceSentAt. */
  sendInvoice(orderId: string): Promise<Order>;
}

export function createInvoicesService(deps: {
  orders: OrdersRepo;
  /** Masked seam — null while WhatsApp sending is disabled (send answers 503). */
  whatsapp: WhatsAppProvider | null;
  /** Test seam; defaults to the real pdfkit renderer. */
  renderPdf?: (order: Order) => Promise<Buffer>;
}): InvoicesService {
  const render = deps.renderPdf ?? renderInvoicePdf;

  async function loadOrder(orderId: string): Promise<Order> {
    const order = await deps.orders.getById(orderId);
    if (!order) throw new DomainError('NOT_FOUND', 'Order not found');
    return order;
  }

  return {
    async invoicePdf(orderId) {
      const order = await loadOrder(orderId);
      return { pdf: await render(order), filename: `${order.orderNumber}.pdf` };
    },

    async sendInvoice(orderId) {
      if (!deps.whatsapp) throw new DomainError('NOT_CONFIGURED', 'WhatsApp sending is not configured');
      const order = await loadOrder(orderId);
      if (!order.phone) throw new DomainError('INVALID_PHONE', 'Customer has no phone number on file');
      const filename = `${order.orderNumber}.pdf`;
      const pdf = await render(order);
      try {
        await deps.whatsapp.sendInvoice(order.phone, pdf, filename, {
          customerName: order.firstName,
          orderNumber: order.orderNumber,
          total: formatINR(order.total),
        });
      } catch (err) {
        throw new DomainError('DELIVERY_FAILED', err instanceof Error ? err.message : 'WhatsApp send failed');
      }
      return (await deps.orders.markInvoiceSent(orderId)) ?? order;
    },
  };
}
