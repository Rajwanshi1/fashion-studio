// Domain types mirrored from backend/src/types.ts (client-safe subset).
// All money values are integer paise.

export type Role = 'customer' | 'admin';

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

/** Canonical colour buckets. Order is the swatch-row display order. */
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

/** Swatch row copy + colour. `swatch` is any CSS background value — 'multi' is a gradient. */
export const COLOR_FAMILY_META: Record<ColorFamily, { label: string; swatch: string }> = {
  red: { label: 'Red', swatch: '#b3202c' },
  pink: { label: 'Pink', swatch: '#e8a0b4' },
  'orange-rust': { label: 'Orange / Rust', swatch: '#c1502e' },
  'yellow-gold': { label: 'Yellow / Gold', swatch: '#d4a72c' },
  green: { label: 'Green', swatch: '#4a6741' },
  blue: { label: 'Blue', swatch: '#2f4d8a' },
  purple: { label: 'Purple', swatch: '#6d4a8a' },
  'white-ivory': { label: 'White / Ivory', swatch: '#f4efe6' },
  'beige-nude': { label: 'Beige / Nude', swatch: '#d9c3a9' },
  brown: { label: 'Brown', swatch: '#6b4a2f' },
  black: { label: 'Black', swatch: '#1a1a1a' },
  multi: { label: 'Multi-color', swatch: 'linear-gradient(135deg,#b3202c,#d4a72c 35%,#4a6741 70%,#2f4d8a)' },
};

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
  /** Base garment price; see displayPrice() for the full-set price. */
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
   *  Add-ons are never discounted — see displaySalePrice(). */
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
  /** Provenance — optional, shown only when filled: the karigar's first name,
   *  honestly counted hours, techniques, finish date (YYYY-MM-DD). */
  karigarName: string;
  hoursWorked: number | null;
  techniques: string;
  finishedOn: string | null;
  related?: ProductSummary[];
}

export type ProductSort = 'featured' | 'new' | 'price_asc' | 'price_desc';

export interface ProductsResponse {
  items: ProductSummary[];
  total: number;
  page: number;
  pages: number;
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
  gstAmount: number | null;
  /** YYYY-MM-DD; null when no delivery date was promised. */
  deliveryDueDate: string | null;
  notes: string;
  /** SUM of receipts, paise — meaningful for offline orders only. */
  advancePaid: number;
  /** total − advancePaid, paise — meaningful for offline orders only. */
  balance: number;
  receipts: Receipt[];
  createdAt: string;
  items: OrderItem[];
}

export interface PaymentInit {
  paymentId: string;
  providerOrderId: string;
  keyId: string;
  amount: number;
  currency: string;
  mock: boolean;
}

export interface AuthResponse {
  token: string;
  user: PublicUser;
}
