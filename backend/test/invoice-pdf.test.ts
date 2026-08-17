import { describe, expect, it } from 'vitest';
import { buildInvoiceModel, formatINR, renderInvoicePdf } from '../src/services/invoice-pdf';
import type { Order, OrderItem } from '../src/types';

function makeItem(over: Partial<OrderItem> = {}): OrderItem {
  return {
    id: 'oi-1',
    productId: null,
    variantId: null,
    productName: 'Cowl Tissue Silk Kaftan — Ombre Dyeing',
    size: '',
    color: '',
    unitPrice: 700000,
    quantity: 1,
    imageUrl: null,
    components: [],
    ...over,
  };
}

/** Offline cash-memo defaults, mirroring what createOfflineOrder produces. */
function makeOrder(over: Partial<Order> = {}): Order {
  return {
    id: 'o-1',
    orderNumber: 'TA-2026-04821',
    userId: 'user-1',
    email: '',
    phone: '+919314420308',
    firstName: 'Lalita',
    lastName: 'Jain',
    addressLine1: 'Plot No. 5, Sanjay Nagar',
    addressLine2: '',
    city: 'Jaipur',
    state: 'Rajasthan',
    pincode: '302015',
    country: 'India',
    deliveryMethod: 'standard',
    deliveryFee: 0,
    subtotal: 700000,
    discountAmount: 0,
    discountReason: '',
    total: 700000,
    status: 'in_atelier',
    channel: 'in_store',
    billType: 'cash_memo',
    billNumber: '02',
    gstAmount: null,
    deliveryDueDate: '2026-08-21',
    carrier: null,
    awb: null,
    notes: '1000 received advance',
    invoiceSentAt: null,
    advancePaid: 100000,
    balance: 600000,
    receipts: [],
    createdAt: '2026-07-21T09:30:00.000Z',
    items: [makeItem()],
    ...over,
  };
}

const totalLabels = (o: Order) => buildInvoiceModel(o).totals.map((t) => t.label);
const metaLabels = (o: Order) => buildInvoiceModel(o).meta.map((m) => m.label);

describe('formatINR', () => {
  it('groups en-IN style and drops paise for whole rupees', () => {
    expect(formatINR(700000)).toBe('₹7,000');
    expect(formatINR(190900000)).toBe('₹19,09,000');
  });

  it('keeps fractional paise when present', () => {
    expect(formatINR(12345)).toBe('₹123.45');
  });
});

describe('buildInvoiceModel', () => {
  it('titles a cash memo CASH MEMO', () => {
    expect(buildInvoiceModel(makeOrder()).title).toBe('CASH MEMO');
  });

  it('titles gst_invoice and online (null billType) orders INVOICE', () => {
    expect(buildInvoiceModel(makeOrder({ billType: 'gst_invoice' })).title).toBe('INVOICE');
    expect(buildInvoiceModel(makeOrder({ billType: null })).title).toBe('INVOICE');
  });

  it('shows the Bill No. row only when the paper bill number exists', () => {
    expect(metaLabels(makeOrder())).toContain('Bill No.');
    expect(metaLabels(makeOrder({ billNumber: null }))).not.toContain('Bill No.');
  });

  it('formats dates and em-dashes a missing delivery date', () => {
    const model = buildInvoiceModel(makeOrder());
    expect(model.meta.find((m) => m.label === 'Date of Delivery')?.value).toBe('21 Aug 2026');
    const noDue = buildInvoiceModel(makeOrder({ deliveryDueDate: null }));
    expect(noDue.meta.find((m) => m.label === 'Date of Delivery')?.value).toBe('—');
  });

  it('joins the address and em-dashes an empty one', () => {
    expect(buildInvoiceModel(makeOrder()).meta.find((m) => m.label === 'Address')?.value).toBe(
      'Plot No. 5, Sanjay Nagar, Jaipur, Rajasthan, 302015',
    );
    const empty = makeOrder({ addressLine1: '', addressLine2: '', city: '', state: '', pincode: '' });
    expect(buildInvoiceModel(empty).meta.find((m) => m.label === 'Address')?.value).toBe('—');
  });

  it('prints offline freeform lines as-is', () => {
    const [item] = buildInvoiceModel(makeOrder()).items;
    expect(item).toEqual({
      sno: 1,
      description: 'Cowl Tissue Silk Kaftan — Ombre Dyeing',
      qty: 1,
      price: '₹7,000',
      amount: '₹7,000',
    });
  });

  it('suffixes online items with variant and add-ons', () => {
    const order = makeOrder({
      items: [
        makeItem({
          productName: 'Anarkali Set',
          size: 'M',
          color: 'Sage',
          // Lowercase names: exactly what the 013 backfill writes for old rows.
          components: [
            { name: 'dupatta', price: 150000 },
            { name: 'jacket', price: 0 },
          ],
          unitPrice: 1849000,
          quantity: 2,
        }),
      ],
    });
    const [item] = buildInvoiceModel(order).items;
    expect(item.description).toBe('Anarkali Set (M · Sage) — with dupatta & jacket');
    expect(item.amount).toBe('₹36,980');
  });

  it('shows GST only when the bill carries a GST line', () => {
    expect(totalLabels(makeOrder())).not.toContain('GST');
    expect(totalLabels(makeOrder({ gstAmount: 35000 }))).toContain('GST');
  });

  it('shows shipping only when a delivery fee was charged', () => {
    expect(totalLabels(makeOrder())).not.toContain('SHIPPING CHARGES');
    expect(totalLabels(makeOrder({ deliveryFee: 25000 }))).toContain('SHIPPING CHARGES');
  });

  it('shows the first-order discount between subtotal and shipping, only when applied', () => {
    expect(totalLabels(makeOrder())).not.toContain('FIRST ORDER — 5%');
    const discounted = makeOrder({
      subtotal: 18400000,
      discountAmount: 920000,
      discountReason: 'first_order_5pct',
      deliveryFee: 25000,
      total: 18400000 + 25000 - 920000,
    });
    const labels = totalLabels(discounted);
    expect(labels.indexOf('FIRST ORDER — 5%')).toBe(labels.indexOf('SUBTOTAL') + 1);
    expect(labels.indexOf('FIRST ORDER — 5%')).toBeLessThan(labels.indexOf('SHIPPING CHARGES'));
    const row = buildInvoiceModel(discounted).totals.find((t) => t.label === 'FIRST ORDER — 5%')!;
    expect(row.value).toBe('−₹9,200');
  });

  it('shows advance and balance rows only when they are non-zero', () => {
    expect(totalLabels(makeOrder())).toEqual(['SUBTOTAL', 'ADVANCE RECEIVED', 'GRAND TOTAL', 'BALANCE DUE']);
    const settled = makeOrder({ advancePaid: 0, balance: 0 });
    expect(totalLabels(settled)).toEqual(['SUBTOTAL', 'GRAND TOTAL']);
  });

  it('bolds GRAND TOTAL and BALANCE DUE', () => {
    const bold = buildInvoiceModel(makeOrder()).totals.filter((t) => t.bold).map((t) => t.label);
    expect(bold).toEqual(['GRAND TOTAL', 'BALANCE DUE']);
  });

  it('nulls empty notes', () => {
    expect(buildInvoiceModel(makeOrder({ notes: '  ' })).notes).toBeNull();
    expect(buildInvoiceModel(makeOrder()).notes).toBe('1000 received advance');
  });
});

describe('renderInvoicePdf', () => {
  it('renders an offline cash memo to a real PDF with fonts embedded', async () => {
    const pdf = await renderInvoicePdf(makeOrder());
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
    expect(pdf.length).toBeGreaterThan(10_000);
  });

  it('renders an online order (variants, shipping, no bill number) without crashing', async () => {
    const online = makeOrder({
      billType: null,
      billNumber: null,
      channel: 'online',
      deliveryFee: 25000,
      gstAmount: 35000,
      notes: '',
      items: [
        makeItem({
          productName: 'Anarkali Set',
          size: 'M',
          color: 'Sage',
          components: [{ name: 'dupatta', price: 150000 }],
        }),
      ],
    });
    const pdf = await renderInvoicePdf(online);
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });

  it('paginates a long bill instead of overflowing', async () => {
    const items = Array.from({ length: 40 }, (_, i) =>
      makeItem({ id: `oi-${i}`, productName: `Custom piece ${i + 1} — hand-embroidered detailing` }),
    );
    const pdf = await renderInvoicePdf(makeOrder({ items }));
    expect(pdf.subarray(0, 5).toString()).toBe('%PDF-');
  });
});
