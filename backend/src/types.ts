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

export type ProductFlag = 'bestseller' | 'new' | null;

export interface ProductSummary {
  id: string;
  slug: string;
  name: string;
  price: number;
  color: string;
  flag: ProductFlag;
  imageUrl: string | null;
  categorySlug: string;
  categoryName: string;
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
  active: boolean;
  variants: Variant[];
}

export type ProductSort = 'featured' | 'new' | 'price_asc' | 'price_desc';

export interface ProductFilter {
  categorySlug?: string;
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
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
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
      | 'INVALID_CREDENTIALS'
      | 'NOT_FOUND'
      | 'INSUFFICIENT_STOCK'
      | 'EMPTY_ORDER'
      | 'INVALID_STATUS_TRANSITION'
      | 'OVER_COLLECTION'
      | 'PAYMENT_ALREADY_FINAL'
      | 'NOT_CONFIGURED'
      | 'INVALID_SOURCE'
      | 'INVALID_LINK',
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
