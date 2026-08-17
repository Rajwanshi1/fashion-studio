import path from 'node:path';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { Order } from '../types';

/**
 * PDF rendering of the store's physical bill (yellow "Cash Memo" book).
 * Brand copy below is transcribed from the paper bill — it changes when the
 * bill book is reprinted, not per deployment, so it lives in code.
 */
const BRAND = {
  name: 'TANVI AGNIHOTRY',
  tagline: 'CONTEMPORARY OCCASION WEAR',
  legalName: 'Durga Trishakti Creations',
  address: 'B-74, Rajendra Marg, Bapu Nagar, Jaipur, Rajasthan - 302015',
  phone: '+91 8118892523',
  instagram: '@tanviagnihotrylabel',
  website: 'www.tanviagnihotry.com',
  email: 'info@tanviagnihotry.com',
  siteUrl: 'https://www.tanviagnihotry.com',
  terms: [
    'All disputes are subject to Jaipur jurisdiction.',
    'We do not accept returns, exchanges and refunds.',
    'Order once placed will not be cancelled.',
    'Minor variations in color, fabric, print & handwork are inherent to handcrafted garments and are not considered defects.',
    'Dry clean only.',
  ],
  thankYou: 'THANK YOU FOR SHOPPING WITH US!',
  signature: 'Authorized Signature',
};

const ASSETS_DIR = process.env.ASSETS_DIR?.trim() || path.join(process.cwd(), 'assets');

/** en-IN grouping, no paise shown for whole-rupee amounts (matches the admin SPA). */
export function formatINR(paise: number): string {
  return `₹${(paise / 100).toLocaleString('en-IN', { maximumFractionDigits: 2 })}`;
}

const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** YYYY-MM-DD → "21 Jul 2026" without a timezone round-trip. */
function formatDateStr(value: string): string {
  const [y, m, d] = value.slice(0, 10).split('-').map(Number);
  return `${d} ${MONTHS[m - 1]} ${y}`;
}

/** Timestamp → the calendar day it was in the boutique (IST), "21 Jul 2026". */
function formatTimestamp(iso: string): string {
  return new Date(iso).toLocaleDateString('en-IN', {
    day: 'numeric',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  });
}

export interface InvoiceModel {
  title: 'CASH MEMO' | 'INVOICE';
  meta: { label: string; value: string }[];
  items: { sno: number; description: string; qty: number; price: string; amount: string }[];
  totals: { label: string; value: string; bold?: boolean }[];
  notes: string | null;
}

/** Pure order → printable-model mapping; every rule here has a unit test. */
export function buildInvoiceModel(order: Order): InvoiceModel {
  const address = [order.addressLine1, order.addressLine2, order.city, order.state, order.pincode]
    .map((s) => s.trim())
    .filter(Boolean)
    .join(', ');

  const meta: InvoiceModel['meta'] = [{ label: 'No.', value: order.orderNumber }];
  if (order.billNumber) meta.push({ label: 'Bill No.', value: order.billNumber });
  meta.push(
    { label: 'Date', value: formatTimestamp(order.createdAt) },
    { label: 'Date of Delivery', value: order.deliveryDueDate ? formatDateStr(order.deliveryDueDate) : '—' },
    { label: 'Customer Name', value: `${order.firstName} ${order.lastName}`.trim() },
    { label: 'Phone No.', value: order.phone || '—' },
    { label: 'Address', value: address || '—' },
  );

  const items = order.items.map((item, i) => {
    let description = item.productName;
    const variant = [item.size, item.color].filter(Boolean).join(' · ');
    if (variant) description += ` (${variant})`;
    const addOns = item.components.map((c) => c.name);
    // The ₹1,000 surcharge is already inside unitPrice — the label discloses it.
    if (item.customColor) addOns.push('custom colour');
    if (addOns.length) description += ` — with ${addOns.join(' & ')}`;
    return {
      sno: i + 1,
      description,
      qty: item.quantity,
      price: formatINR(item.unitPrice),
      amount: formatINR(item.unitPrice * item.quantity),
    };
  });

  const totals: InvoiceModel['totals'] = [{ label: 'SUBTOTAL', value: formatINR(order.subtotal) }];
  if (order.gstAmount != null) totals.push({ label: 'GST', value: formatINR(order.gstAmount) });
  if (order.deliveryFee > 0) totals.push({ label: 'SHIPPING CHARGES', value: formatINR(order.deliveryFee) });
  if (order.advancePaid > 0) totals.push({ label: 'ADVANCE RECEIVED', value: formatINR(order.advancePaid) });
  totals.push({ label: 'GRAND TOTAL', value: formatINR(order.total), bold: true });
  if (order.balance > 0) totals.push({ label: 'BALANCE DUE', value: formatINR(order.balance), bold: true });

  return {
    title: order.billType === 'cash_memo' ? 'CASH MEMO' : 'INVOICE',
    meta,
    items,
    totals,
    notes: order.notes.trim() || null,
  };
}

const PAGE = { width: 595.28, height: 841.89, margin: 36 };
const INNER = PAGE.width - PAGE.margin * 2;
const GOLD = '#8a6d3b';
const INK = '#1a1a1a';
const MUTED = '#555555';
const RULE = '#bbbbbb';

const COLS = { sno: 28, qty: 40, price: 78, amount: 88 };
const DESC_WIDTH = INNER - COLS.sno - COLS.qty - COLS.price - COLS.amount;

export async function renderInvoicePdf(order: Order): Promise<Buffer> {
  const model = buildInvoiceModel(order);
  const qr = await QRCode.toBuffer(BRAND.siteUrl, { width: 240, margin: 0 });

  return new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({ size: 'A4', margin: PAGE.margin, info: { Title: `${model.title} ${order.orderNumber}` } });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.on('error', reject);

    doc.registerFont('Body', path.join(ASSETS_DIR, 'fonts', 'NotoSans-Regular.ttf'));
    doc.registerFont('Bold', path.join(ASSETS_DIR, 'fonts', 'NotoSans-Bold.ttf'));

    const left = PAGE.margin;
    const right = PAGE.width - PAGE.margin;
    const pageBottom = PAGE.height - PAGE.margin;

    // ── Brand header ──────────────────────────────────────────────────────
    doc.font('Bold').fontSize(19).fillColor(INK).text(BRAND.name, left, PAGE.margin, {
      width: INNER,
      align: 'center',
      characterSpacing: 5,
    });
    doc.font('Body').fontSize(7).fillColor(MUTED).text(BRAND.tagline, { width: INNER, align: 'center', characterSpacing: 2.5 });
    doc.fontSize(8).fillColor(GOLD).text(BRAND.legalName, { width: INNER, align: 'center' });
    doc.moveDown(0.6);
    doc.moveTo(left, doc.y).lineTo(right, doc.y).lineWidth(0.8).strokeColor(INK).stroke();

    // ── Title + store contact (left), QR (right) ──────────────────────────
    const blockTop = doc.y + 10;
    doc.font('Bold').fontSize(13).fillColor(INK).text(model.title, left, blockTop, { characterSpacing: 2 });
    doc.font('Body').fontSize(7.5).fillColor(MUTED);
    doc.text(BRAND.address, left, doc.y + 3, { width: INNER - 110 });
    doc.text(`${BRAND.phone}  ·  ${BRAND.instagram}`);
    doc.text(`${BRAND.website}  ·  ${BRAND.email}`);

    const qrSize = 62;
    doc.image(qr, right - qrSize, blockTop, { width: qrSize });
    doc.font('Body').fontSize(6).fillColor(MUTED).text('Scan to view collection', right - qrSize - 12, blockTop + qrSize + 3, {
      width: qrSize + 24,
      align: 'center',
    });

    // ── Order / customer meta ─────────────────────────────────────────────
    let y = Math.max(doc.y, blockTop + qrSize + 14) + 8;
    for (const row of model.meta) {
      doc.font('Bold').fontSize(8.5).fillColor(INK).text(`${row.label} : `, left, y, { continued: true });
      doc.font('Body').text(row.value, { width: INNER });
      y = doc.y + 2;
    }
    y += 6;

    // ── Items table ───────────────────────────────────────────────────────
    const xSno = left;
    const xDesc = xSno + COLS.sno;
    const xQty = xDesc + DESC_WIDTH;
    const xPrice = xQty + COLS.qty;
    const xAmount = xPrice + COLS.price;

    const tableHeader = () => {
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.8).strokeColor(INK).stroke();
      y += 5;
      doc.font('Bold').fontSize(8).fillColor(INK);
      doc.text('S.NO', xSno, y, { width: COLS.sno });
      doc.text('DESCRIPTION', xDesc, y, { width: DESC_WIDTH });
      doc.text('QTY', xQty, y, { width: COLS.qty, align: 'right' });
      doc.text('PRICE (₹)', xPrice, y, { width: COLS.price, align: 'right' });
      doc.text('AMOUNT (₹)', xAmount, y, { width: COLS.amount, align: 'right' });
      y += 13;
      doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(RULE).stroke();
      y += 6;
    };
    tableHeader();

    doc.font('Body').fontSize(9).fillColor(INK);
    for (const item of model.items) {
      const rowHeight = Math.max(doc.heightOfString(item.description, { width: DESC_WIDTH }), 11) + 6;
      if (y + rowHeight > pageBottom) {
        doc.addPage();
        y = PAGE.margin;
        tableHeader();
        doc.font('Body').fontSize(9).fillColor(INK);
      }
      doc.text(String(item.sno), xSno, y, { width: COLS.sno });
      doc.text(item.description, xDesc, y, { width: DESC_WIDTH });
      doc.text(String(item.qty), xQty, y, { width: COLS.qty, align: 'right' });
      doc.text(item.price, xPrice, y, { width: COLS.price, align: 'right' });
      doc.text(item.amount, xAmount, y, { width: COLS.amount, align: 'right' });
      y += rowHeight;
    }
    doc.moveTo(left, y).lineTo(right, y).lineWidth(0.5).strokeColor(RULE).stroke();
    y += 8;

    // ── Totals (right-aligned column) ─────────────────────────────────────
    const totalsLabelX = xQty - 40;
    for (const row of model.totals) {
      if (y + 16 > pageBottom) {
        doc.addPage();
        y = PAGE.margin;
      }
      if (row.label === 'GRAND TOTAL') {
        doc.moveTo(totalsLabelX, y - 2).lineTo(right, y - 2).lineWidth(0.8).strokeColor(INK).stroke();
        y += 3;
      }
      doc.font(row.bold ? 'Bold' : 'Body').fontSize(9).fillColor(INK);
      doc.text(row.label, totalsLabelX, y, { width: xAmount - totalsLabelX - 8, align: 'right' });
      doc.text(row.value, xAmount, y, { width: COLS.amount, align: 'right' });
      y = doc.y + 3;
    }
    y += 6;

    if (model.notes) {
      if (y + 30 > pageBottom) {
        doc.addPage();
        y = PAGE.margin;
      }
      doc.font('Bold').fontSize(8.5).fillColor(INK).text('Notes : ', left, y, { continued: true });
      doc.font('Body').text(model.notes, { width: INNER });
      y = doc.y + 8;
    }

    // ── Terms (left) + signature (right) footer block ─────────────────────
    const termsWidth = INNER - 170;
    const footerHeight =
      20 +
      BRAND.terms.reduce((h, t) => h + doc.heightOfString(`0. ${t}`, { width: termsWidth }) + 2, 0) +
      24;
    if (y + footerHeight > pageBottom) {
      doc.addPage();
      y = PAGE.margin;
    }
    const footerTop = y;
    doc.font('Bold').fontSize(7.5).fillColor(INK).text('TERMS & CONDITIONS', left, y);
    y = doc.y + 2;
    doc.font('Body').fontSize(7).fillColor(MUTED);
    BRAND.terms.forEach((term, i) => {
      doc.text(`${i + 1}. ${term}`, left, y, { width: termsWidth });
      y = doc.y + 2;
    });

    const signY = Math.max(y, footerTop + 40);
    doc.moveTo(right - 150, signY).lineTo(right, signY).lineWidth(0.5).strokeColor(INK).stroke();
    doc.font('Body').fontSize(7.5).fillColor(INK).text(BRAND.signature, right - 150, signY + 3, { width: 150, align: 'center' });
    doc.fontSize(7).fillColor(MUTED).text(BRAND.legalName, right - 150, doc.y + 1, { width: 150, align: 'center' });

    doc.font('Bold').fontSize(8).fillColor(GOLD).text(BRAND.thankYou, left, Math.max(doc.y, y) + 14, {
      width: INNER,
      align: 'center',
      characterSpacing: 1.5,
    });

    doc.end();
  });
}
