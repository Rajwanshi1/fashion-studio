import { describe, expect, it, vi } from 'vitest';
import { INVOICE_TEMPLATE, MetaWhatsAppProvider } from '../src/services/whatsapp.provider';

const PDF = Buffer.from('%PDF-fake');
const VARS = { customerName: 'Rhea', orderNumber: 'TA-2026-04818', total: '₹45,000' };

const okJson = (body: unknown) => ({ ok: true, status: 200, json: async () => body });
const errJson = (status: number, body: unknown) => ({ ok: false, status, json: async () => body });

function makeProvider(...responses: unknown[]) {
  const fetchFn = vi.fn();
  for (const r of responses) fetchFn.mockResolvedValueOnce(r);
  const provider = new MetaWhatsAppProvider('TOKEN', 'PNID', fetchFn as unknown as typeof fetch);
  return { provider, fetchFn };
}

describe('MetaWhatsAppProvider', () => {
  it('uploads the PDF as media, then sends the document template', async () => {
    const { provider, fetchFn } = makeProvider(okJson({ id: 'MEDIA-1' }), okJson({ messages: [{ id: 'wamid.1' }] }));

    await provider.sendInvoice('+91 98200-11223', PDF, 'TA-2026-04818.pdf', VARS);

    expect(fetchFn).toHaveBeenCalledTimes(2);

    const [uploadUrl, uploadInit] = fetchFn.mock.calls[0];
    expect(uploadUrl).toBe('https://graph.facebook.com/v21.0/PNID/media');
    expect(uploadInit.method).toBe('POST');
    expect(uploadInit.headers.Authorization).toBe('Bearer TOKEN');
    const form = uploadInit.body as FormData;
    expect(form.get('messaging_product')).toBe('whatsapp');
    expect(form.get('type')).toBe('application/pdf');
    const file = form.get('file') as File;
    expect(file.name).toBe('TA-2026-04818.pdf');
    expect(file.type).toBe('application/pdf');
    expect(file.size).toBe(PDF.length);

    const [messageUrl, messageInit] = fetchFn.mock.calls[1];
    expect(messageUrl).toBe('https://graph.facebook.com/v21.0/PNID/messages');
    expect(messageInit.headers.Authorization).toBe('Bearer TOKEN');
    const payload = JSON.parse(messageInit.body as string);
    expect(payload).toEqual({
      messaging_product: 'whatsapp',
      to: '919820011223',
      type: 'template',
      template: {
        name: INVOICE_TEMPLATE.name,
        language: { code: INVOICE_TEMPLATE.language },
        components: [
          {
            type: 'header',
            parameters: [{ type: 'document', document: { id: 'MEDIA-1', filename: 'TA-2026-04818.pdf' } }],
          },
          {
            type: 'body',
            parameters: [
              { type: 'text', text: 'Rhea' },
              { type: 'text', text: 'TA-2026-04818' },
              { type: 'text', text: '₹45,000' },
            ],
          },
        ],
      },
    });
  });

  it('surfaces the Graph error message on a failed upload and never sends', async () => {
    const { provider, fetchFn } = makeProvider(errJson(401, { error: { message: 'Invalid OAuth access token' } }));
    await expect(provider.sendInvoice('+919820011223', PDF, 'x.pdf', VARS)).rejects.toThrow(
      /media upload failed: Invalid OAuth access token/,
    );
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('falls back to the HTTP status when the error body is not JSON', async () => {
    const { provider } = makeProvider({ ok: false, status: 500, json: async () => { throw new Error('not json'); } });
    await expect(provider.sendInvoice('+919820011223', PDF, 'x.pdf', VARS)).rejects.toThrow(
      /media upload failed: HTTP 500/,
    );
  });

  it('throws when the upload succeeds without a media id', async () => {
    const { provider, fetchFn } = makeProvider(okJson({}));
    await expect(provider.sendInvoice('+919820011223', PDF, 'x.pdf', VARS)).rejects.toThrow(/no media id/);
    expect(fetchFn).toHaveBeenCalledTimes(1);
  });

  it('surfaces the Graph error message on a failed template send', async () => {
    const { provider } = makeProvider(
      okJson({ id: 'MEDIA-1' }),
      errJson(400, { error: { message: 'Template name does not exist' } }),
    );
    await expect(provider.sendInvoice('+919820011223', PDF, 'x.pdf', VARS)).rejects.toThrow(
      /message send failed: Template name does not exist/,
    );
  });

  it('treats a 200 body carrying an error object as a failure', async () => {
    const { provider } = makeProvider(okJson({ id: 'MEDIA-1' }), okJson({ error: { message: 'Recipient not on WhatsApp' } }));
    await expect(provider.sendInvoice('+919820011223', PDF, 'x.pdf', VARS)).rejects.toThrow(
      /Recipient not on WhatsApp/,
    );
  });
});
