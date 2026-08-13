// Domain types shared across layers. All money values are integer paise.

export type Role = 'customer' | 'admin';

export type AuthProvider = 'password' | 'google' | 'otp';

export interface User {
  id: string;
  /** Null for phone-only accounts (created via OTP login or offline bills). */
  email: string | null;
  /** Null for accounts created through Google sign-in or phone OTP. */
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  authProvider: AuthProvider;
  /** E.164 (+91…); null until a phone is attached. */
  phone: string | null;
  phoneVerified: boolean;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: Role;
}

export interface Category {
  id: string;
  slug: string;
  name: string;
  description: string;
  position: number;
  productCount?: number;
}

export type ProductFlag = 'bestseller' | 'new' | 'sale' | null;

/** Canonical colour buckets. Order is the shop's swatch-row display order. */
export const COLOR_FAMILIES = [
  'red',
  'pink',
  'orange-rust',
  'yellow-gold',
  'green',
  'blue',
  'purple',
  'white-ivory',
  'beige-nude',
  'brown',
  'black',
  'multi',
] as const;

export type ColorFamily = (typeof COLOR_FAMILIES)[number];

/** One gallery photo. `pose` is a short label ('front', 'drape', …), '' when unknown. */
export interface ProductImage {
  url: string;
  pose: string;
  /** Display name of the garment's colour in THIS photo ("Maroon"); '' when unknown. */
  color: string;
  /** CSS '#rrggbb' fill for the colour swatch; '' when unknown. */
  colorHex: string;
}

/** One piece of the set ("This order contains"), in display order. */
export interface ProductComponent {
  id: string;
  name: string;
  /** Optional pieces are tickable on the PDP; required pieces always ship. */
  optional: boolean;
  /** Paise; only meaningful when optional. null = no separate price, 0 = included free. */
  price: number | null;
}

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  /** Base garment price; add addonsTotal for the full-set price. */
  price: number;
  color: string;
  flag: ProductFlag;
  imageUrl: string | null;
  categorySlug: string;
  categoryName: string;
  collection: string;
  occasion: string;
  /** Paise; SUM of optional priced component prices — the default-included
   *  add-ons. 0 when none. */
  addonsTotal: number;
  /** Canonical colour bucket for the shop filter; null when never resolved. */
  colorFamily: ColorFamily | null;
  /** Paise; discounted BASE price, meaningful only when flag === 'sale'.
   *  Add-ons are never discounted. */
  salePrice: number | null;
}

export interface Variant {
  id: string;
  productId: string;
  size: string;
  stock: number;
}

export interface ProductDetail extends ProductSummary {
  description: string;
  details: string;
  craft: string;
  fabric: string;
  active: boolean;
  variants: Variant[];
  /** Ordered gallery; images[0].url mirrors imageUrl. */
  images: ProductImage[];
  /** "This order contains" — every piece of the set, in display order. */
  components: ProductComponent[];
  /** Provenance — optional, shown only when filled (audit §06): the karigar's
   *  first name, honestly counted hours, techniques, finish date (YYYY-MM-DD). */
  karigarName: string;
  hoursWorked: number | null;
  techniques: string;
  finishedOn: string | null;
}

export type ProductSort = 'featured' | 'new' | 'price_asc' | 'price_desc';

export interface ProductFilter {
  categorySlug?: string;
  collection?: string;
  colorFamily?: ColorFamily;
  search?: string;
  sort?: ProductSort;
  page: number;
  limit: number;
}

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'in_atelier'
  | 'quality_check'
  | 'dispatched'
  | 'delivered'
  | 'cancelled';

export type DeliveryMethod = 'standard' | 'priority';

export type OrderChannel = 'online' | 'in_store' | 'instagram' | 'exhibition';

export type BillType = 'gst_invoice' | 'cash_memo';

export type ReceiptMode = 'cash' | 'online';

export interface OrderItem {
  id: string;
  /** Null for offline freeform lines (handwritten-bill descriptions). */
  productId: string | null;
  variantId: string | null;
  productName: string;
  size: string;
  color: string;
  /** Final per-unit price: base garment + chosen add-ons. */
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
  /** Kept optional add-ons snapshotted at order time; price paise, 0 = included free. */
  components: { name: string; price: number }[];
  /** Free-text made-to-measure note; '' when none. */
  measurements: string;
}

export interface Receipt {
  id: string;
  orderId: string;
  amount: number;
  mode: ReceiptMode;
  /** YYYY-MM-DD. */
  receivedAt: string;
  note: string;
  createdAt: string;
}

export interface Order {
  id: string;
  orderNumber: string;
  userId: string | null;
  email: string;
  phone: string;
  firstName: string;
  lastName: string;
  addressLine1: string;
  addressLine2: string;
  city: string;
  state: string;
  pincode: string;
  country: string;
  deliveryMethod: DeliveryMethod;
  deliveryFee: number;
  subtotal: number;
  total: number;
  status: OrderStatus;
  channel: OrderChannel;
  billType: BillType | null;
  billNumber: string | null;
  /** Paise; null when the bill carries no GST line. */
  gstAmount: number | null;
  /** YYYY-MM-DD; null when no delivery date was promised. */
  deliveryDueDate: string | null;
  /** Courier name from the shipping receipt; null until dispatched. */
  carrier: string | null;
  /** AWB / consignment number; null until dispatched. */
  awb: string | null;
  notes: string;
  /** When the PDF invoice was last WhatsApped to the customer; null = never. */
  invoiceSentAt: string | null;
  /** SUM of receipts, paise. */
  advancePaid: number;
  /** total − advancePaid, paise. */
  balance: number;
  receipts: Receipt[];
  createdAt: string;
  items: OrderItem[];
}

export type PaymentStatus = 'created' | 'captured' | 'failed' | 'refunded';

export interface Payment {
  id: string;
  orderId: string;
  provider: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  method: string;
  createdAt: string;
}

/**
 * Opaque transaction handle. The real runner passes a pg PoolClient; fakes pass
 * anything. Repos cast it back — services never see pg types.
 */
export type Tx = unknown;

export type TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => Promise<T>;

/** Typed domain error the HTTP layer maps to status codes. */
export class DomainError extends Error {
  constructor(
    public code:
      | 'EMAIL_TAKEN'
      | 'PHONE_TAKEN'
      | 'INVALID_PHONE'
      | 'TOO_MANY_REQUESTS'
      | 'SLUG_TAKEN'
      | 'INVALID_CREDENTIALS'
      | 'NOT_FOUND'
      | 'PRICE_CHANGED'
      | 'EMPTY_ORDER'
      | 'INVALID_STATUS_TRANSITION'
      | 'OVER_COLLECTION'
      | 'ORDER_CANCELLED'
      | 'BILL_NUMBER_REQUIRED'
      | 'PAYMENT_ALREADY_FINAL'
      | 'NOT_CONFIGURED'
      | 'INVALID_SOURCE'
      | 'INVALID_LINK'
      | 'DELIVERY_FAILED',
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
