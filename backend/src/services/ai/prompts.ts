// THE tuning file for document parsing — isolated on purpose so prompt/schema
// iteration (once real bill photos arrive) touches nothing else. Each kind gets
// a JSON Schema (draft 2020-12 style plain object, fed to the Claude API as a
// structured-output format) and a prompt string.
//
// Conventions:
//   - All money values are RUPEES AS WRITTEN on the page (plain numbers) —
//     conversion to integer paise happens at human-confirm time, never here.
//   - "Not present / illegible" is null everywhere EXCEPT the bill schema's
//     string fields, which use "" instead — see `emptyableString` for why.
//   - Doubts go into `confidence_notes` (required on bill).
//   - Measurement values are VERBATIM strings ("38½", "15 in") — no unit or
//     fraction normalization at parse time.

export type ParseKind = 'bill' | 'measurement' | 'shipping_receipt';

export interface KindSpec {
  /** JSON Schema (2020-12 style plain object) the draft must conform to. */
  schema: Record<string, unknown>;
  /** Instruction prompt sent alongside the photo. */
  prompt: string;
  /** Claude API model id for this kind, e.g. `claude-opus-5`. */
  model: string;
  /**
   * Thinking effort. Claude 5 models think adaptively and default to `high` on
   * the API, which for mechanical extraction mostly buys latency and output
   * tokens. Start low-ish and raise only where a real photo proves it helps.
   */
  effort: 'low' | 'medium' | 'high';
}

const nullableString = { type: ['string', 'null'] };
const nullableNumber = { type: ['number', 'null'] };
const nullableInteger = { type: ['integer', 'null'] };

/**
 * A string field that signals "not present / illegible" with "" rather than null.
 *
 * Used by billSchema ONLY, and not for style: the API rejects a structured-output
 * schema carrying more than 16 union-typed parameters (anything with a `type`
 * array or `anyOf`). billSchema had 18 — 10 nullable strings + 8 nullable
 * numbers — so every bill parse 400'd with "Schemas contains too many parameters
 * with union types … limit: 16" while the two smaller schemas were unaffected.
 *
 * Strings already carry their own empty sentinel, so dropping `| null` from the
 * 10 string fields costs no expressiveness and brings the count to 8, leaving
 * real headroom for future fields. The numbers keep `| null` deliberately: 0 is
 * a legitimate rupee amount, so they have no spare sentinel. Enums with a null
 * member are not counted by the API and are left alone.
 *
 * Consumers need no special handling — `mapBillDraft` reads every one of these
 * through `str()` (`?? ''`), for which "" and null are already identical.
 */
const emptyableString = { type: 'string', description: 'Empty string "" if absent or illegible.' };

const billSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    bill: {
      type: 'object',
      additionalProperties: false,
      properties: {
        bill_number: emptyableString,
        bill_date: { ...emptyableString, description: 'ISO date yyyy-mm-dd, or "" if absent/illegible' },
        bill_type: { enum: ['gst_invoice', 'cash_memo', null] },
        channel_guess: { enum: ['in_store', 'instagram', 'exhibition', null] },
      },
      required: ['bill_number', 'bill_date', 'bill_type', 'channel_guess'],
    },
    customer: {
      type: 'object',
      additionalProperties: false,
      properties: {
        name: emptyableString,
        phone: { ...emptyableString, description: 'Phone number exactly as written, or "" if absent' },
        email: emptyableString,
        address: emptyableString,
        city: emptyableString,
        state: emptyableString,
        pincode: emptyableString,
      },
      required: ['name', 'phone', 'email', 'address', 'city', 'state', 'pincode'],
    },
    items: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          description: { type: 'string' },
          quantity: nullableInteger,
          unit_price_rupees: nullableNumber,
          line_total_rupees: nullableNumber,
        },
        required: ['description', 'quantity', 'unit_price_rupees', 'line_total_rupees'],
      },
    },
    totals: {
      type: 'object',
      additionalProperties: false,
      properties: {
        subtotal_rupees: nullableNumber,
        gst_rupees: nullableNumber,
        total_rupees: nullableNumber,
        advance_rupees: nullableNumber,
        balance_rupees: nullableNumber,
        advance_mode: { enum: ['cash', 'online', null] },
      },
      required: ['subtotal_rupees', 'gst_rupees', 'total_rupees', 'advance_rupees', 'balance_rupees', 'advance_mode'],
    },
    delivery: {
      type: 'object',
      additionalProperties: false,
      properties: {
        due_date: { ...emptyableString, description: 'ISO date yyyy-mm-dd, or "" if absent/illegible' },
      },
      required: ['due_date'],
    },
    confidence_notes: {
      type: 'string',
      description: 'Anything you were unsure about — illegible words, ambiguous numbers, guessed fields.',
    },
  },
  required: ['bill', 'customer', 'items', 'totals', 'delivery', 'confidence_notes'],
};

const billPrompt = `You are reading a photo of a handwritten bill from an Indian fashion boutique (custom lehengas, gowns, blouses). Bills may be GST invoices or plain cash memos, often partly printed and partly handwritten.

Extract the bill exactly per the response schema:
- All money values are rupees AS WRITTEN on the bill, as plain numbers (e.g. "₹12,500" -> 12500, "12,500.50" -> 12500.5). Do NOT convert to paise.
- Absent or illegible: use "" for text fields (bill_number, bill_date, name, phone, email, address, city, state, pincode, due_date) and null for number fields and for bill_type/channel_guess/advance_mode. Never invent values.
- Dates: convert to ISO yyyy-mm-dd. Handwritten dates follow the Indian dd/mm/yyyy convention (e.g. "5/3/26" means 2026-03-05). Guess the century sensibly for two-digit years.
- bill_type: "gst_invoice" if GSTIN/GST breakup appears, "cash_memo" for a plain memo, null if unclear.
- channel_guess: your best guess where the sale happened ("in_store", "instagram", "exhibition") based on any hints on the bill, else null.
- Phone numbers: copy exactly as written, including spaces or dashes. Do not reformat.
- items: one entry per line item, description verbatim (garment names may be in Hinglish — copy what is written).
- totals: read subtotal, GST, grand total, advance received, and balance due if shown. advance_mode is "cash" or "online" only if the bill says so.
- confidence_notes: REQUIRED. List everything you were unsure of — illegible words, ambiguous digits, fields you guessed. If everything was clear, say so briefly.`;

const measurementSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    person_name: nullableString,
    garment: nullableString,
    measurements: {
      type: 'array',
      items: {
        type: 'object',
        additionalProperties: false,
        properties: {
          name: { type: 'string' },
          value: { type: 'string', description: 'VERBATIM as written, e.g. "38½", "15 in"' },
        },
        required: ['name', 'value'],
      },
    },
    notes: nullableString,
  },
  required: ['person_name', 'garment', 'measurements', 'notes'],
};

const measurementPrompt = `You are reading a photo of a handwritten garment measurement page from an Indian fashion boutique's notebook. It records body/garment measurements taken for a customer, often with abbreviations (SH for shoulder, SL for sleeve length, etc.) and mixed fractions.

Extract exactly per the response schema:
- person_name: the customer name if written on the page, else null.
- garment: what the measurements are for (e.g. "blouse", "lehenga", "gown") if indicated, else null.
- measurements: one entry per measurement line. name is the label as written (keep abbreviations as-is). value is the VERBATIM string exactly as written — keep fractions and units untouched ("38½", "15 in", "42.5"). Do NOT normalize, convert, or compute anything.
- notes: any other remarks on the page (fit preferences, fabric notes), else null.
- Use null for anything absent; skip lines that are fully illegible rather than guessing.`;

const shippingReceiptSchema: Record<string, unknown> = {
  type: 'object',
  additionalProperties: false,
  properties: {
    carrier: nullableString,
    awb_number: nullableString,
    ship_date: { ...nullableString, description: 'ISO date yyyy-mm-dd' },
    destination_hint: nullableString,
    notes: nullableString,
  },
  required: ['carrier', 'awb_number', 'ship_date', 'destination_hint', 'notes'],
};

const shippingReceiptPrompt = `You are reading a photo of a courier/shipping receipt from an Indian courier service (e.g. DTDC, Blue Dart, Delhivery, India Post, Professional Couriers). It may be a printed label, a handwritten consignment slip, or both.

Extract exactly per the response schema:
- carrier: the courier company name as printed/written, else null.
- awb_number: the AWB / consignment / tracking number exactly as written, else null.
- ship_date: booking/ship date converted to ISO yyyy-mm-dd — handwritten dates follow the Indian dd/mm/yyyy convention — else null.
- destination_hint: destination city/pincode/address fragment if visible, else null.
- notes: anything else useful (weight, COD amount, service type), else null.
- Use null for anything absent or illegible. Never invent values.`;

/**
 * Model per kind. Opus 5 reads the two handwritten pages: handwriting is the
 * hardest OCR there is, the numbers on them are money and body measurements,
 * and every miss costs a correction on the review screen. Courier receipts are
 * mostly printed labels, so Sonnet 5 handles them at a fraction of the cost.
 *
 * Compare these empirically with `npm run parse:photo` rather than by argument —
 * it prints tokens, latency and measured cost for one real photo.
 */
export const PARSE_SPECS: Record<ParseKind, KindSpec> = {
  bill: { schema: billSchema, prompt: billPrompt, model: 'claude-opus-5', effort: 'medium' },
  measurement: { schema: measurementSchema, prompt: measurementPrompt, model: 'claude-opus-5', effort: 'medium' },
  shipping_receipt: {
    schema: shippingReceiptSchema,
    prompt: shippingReceiptPrompt,
    model: 'claude-sonnet-5',
    effort: 'low',
  },
};
