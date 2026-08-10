/**
 * Masked WhatsApp seam, mirroring SmsProvider: null means invoice sending is
 * not configured and the send endpoint answers 503.
 */

/** Body variables of the approved invoice template, in template order. */
export interface InvoiceVars {
  customerName: string;
  orderNumber: string;
  total: string;
}

export interface WhatsAppProvider {
  /** Uploads the PDF and sends the approved invoice template. Throws on failure. */
  sendInvoice(phone: string, pdf: Buffer, filename: string, vars: InvoiceVars): Promise<void>;
}

/** Dev/staging provider: logs the send instead of performing it. */
export class ConsoleWhatsAppProvider implements WhatsAppProvider {
  async sendInvoice(phone: string, pdf: Buffer, filename: string, vars: InvoiceVars): Promise<void> {
    console.log(`[whatsapp] would send ${filename} (${pdf.length} bytes, ${vars.total}) to ${phone}`);
  }
}

/**
 * Must match the template approved in Meta Business Manager exactly: name,
 * language, DOCUMENT header, and the three body variables of InvoiceVars in
 * order. Template copy changes need Meta re-approval; variable changes need a
 * change here too — they are coupled by design. See docs/whatsapp-invoices.md.
 */
export const INVOICE_TEMPLATE = { name: 'order_invoice', language: 'en' } as const;

const GRAPH_BASE = 'https://graph.facebook.com/v21.0';

interface GraphResponse {
  id?: string;
  error?: { message?: string };
}

/** WhatsApp Business Cloud API: upload the PDF as media, then send the template. */
export class MetaWhatsAppProvider implements WhatsAppProvider {
  constructor(
    private accessToken: string,
    private phoneNumberId: string,
    private fetchFn: typeof fetch = fetch,
  ) {}

  async sendInvoice(phone: string, pdf: Buffer, filename: string, vars: InvoiceVars): Promise<void> {
    const mediaId = await this.uploadMedia(pdf, filename);
    await this.sendTemplate(phone, mediaId, filename, vars);
  }

  private async graph(pathname: string, init: RequestInit, step: string): Promise<GraphResponse> {
    const res = await this.fetchFn(`${GRAPH_BASE}/${this.phoneNumberId}${pathname}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.accessToken}`, ...(init.headers as Record<string, string> | undefined) },
    });
    const body = (await res.json().catch(() => null)) as GraphResponse | null;
    if (!res.ok || body?.error) {
      throw new Error(`WhatsApp ${step} failed: ${body?.error?.message ?? `HTTP ${res.status}`}`);
    }
    return body ?? {};
  }

  private async uploadMedia(pdf: Buffer, filename: string): Promise<string> {
    const form = new FormData();
    form.set('messaging_product', 'whatsapp');
    form.set('type', 'application/pdf');
    form.set('file', new Blob([pdf], { type: 'application/pdf' }), filename);
    const body = await this.graph('/media', { method: 'POST', body: form }, 'media upload');
    if (!body.id) throw new Error('WhatsApp media upload failed: no media id in response');
    return body.id;
  }

  private async sendTemplate(phone: string, mediaId: string, filename: string, vars: InvoiceVars): Promise<void> {
    await this.graph(
      '/messages',
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          messaging_product: 'whatsapp',
          to: phone.replace(/[^0-9]/g, ''),
          type: 'template',
          template: {
            name: INVOICE_TEMPLATE.name,
            language: { code: INVOICE_TEMPLATE.language },
            components: [
              { type: 'header', parameters: [{ type: 'document', document: { id: mediaId, filename } }] },
              {
                type: 'body',
                parameters: [
                  { type: 'text', text: vars.customerName },
                  { type: 'text', text: vars.orderNumber },
                  { type: 'text', text: vars.total },
                ],
              },
            ],
          },
        }),
      },
      'message send',
    );
  }
}
