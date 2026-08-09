import { useState } from 'react';
import { formatDate } from '../lib/format';
import { downloadInvoicePdf, sendInvoice } from '../lib/invoice';
import type { Order } from '../lib/types';
import { useToast } from './Toast';

interface InvoiceActionsProps {
  order: Order;
  onUpdated?: (order: Order) => void;
}

/** Invoice PDF download + WhatsApp send — shared by the done cards and the orders table. */
export function InvoiceActions({ order, onUpdated }: InvoiceActionsProps) {
  const toast = useToast();
  const [busy, setBusy] = useState(false);

  const download = async () => {
    try {
      await downloadInvoicePdf(order);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to download invoice', { tone: 'error' });
    }
  };

  const send = async () => {
    setBusy(true);
    try {
      const updated = await sendInvoice(order.id);
      onUpdated?.(updated);
      toast(`Invoice sent to ${order.phone} on WhatsApp`);
    } catch (err) {
      toast(err instanceof Error ? err.message : 'Unable to send invoice', { tone: 'error' });
    } finally {
      setBusy(false);
    }
  };

  return (
    <>
      <button type="button" className="btn-outline fit" onClick={download}>
        Invoice PDF
      </button>
      <button type="button" className="btn-outline fit" onClick={send} disabled={!order.phone || busy}>
        {busy ? 'Sending…' : order.invoiceSentAt ? 'Re-send invoice on WhatsApp' : 'Send invoice on WhatsApp'}
      </button>
      {order.invoiceSentAt && <p className="x">Invoice sent {formatDate(order.invoiceSentAt)}</p>}
    </>
  );
}
