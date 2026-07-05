// Domain types mirrored from backend/src/types.ts (client-safe subset).
// All money values are integer paise.

export type Role = 'customer' | 'admin';

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
