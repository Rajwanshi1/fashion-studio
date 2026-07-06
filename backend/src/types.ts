// Domain types shared across layers. All money values are integer paise.

export type Role = 'customer' | 'admin';

export type AuthProvider = 'password' | 'google';

export interface User {
  id: string;
  email: string;
  /** Null for accounts created through Google sign-in. */
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  authProvider: AuthProvider;
  createdAt: string;
}

export interface PublicUser {
  id: string;
  email: string;
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

export interface OrderItem {
  id: string;
  productId: string;
  variantId: string;
  productName: string;
  size: string;
  color: string;
  unitPrice: number;
  quantity: number;
  imageUrl: string | null;
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
      | 'INVALID_CREDENTIALS'
      | 'NOT_FOUND'
      | 'INSUFFICIENT_STOCK'
      | 'EMPTY_ORDER'
      | 'INVALID_STATUS_TRANSITION'
      | 'PAYMENT_ALREADY_FINAL'
      | 'NOT_CONFIGURED'
      | 'INVALID_SOURCE',
    message: string,
  ) {
    super(message);
    this.name = 'DomainError';
  }
}
