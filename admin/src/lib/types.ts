// Mirrors backend/src/types.ts response shapes. All money values are integer paise.

export type Role = 'customer' | 'admin';

export interface PublicUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
}

export type AuthProvider = 'password' | 'google';

export interface AdminUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: Role;
  authProvider: AuthProvider;
  createdAt: string;
  ordersCount: number;
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

export interface Variant {
  id: string;
  productId: string;
  size: string;
  stock: number;
}

export interface AdminProduct {
  id: string;
  slug: string;
  name: string;
  price: number;
  color: string;
  flag: ProductFlag;
  imageUrl: string | null;
  categorySlug: string;
  categoryName: string;
  description: string;
  details: string;
  active: boolean;
  variants: Variant[];
}

export type OrderStatus =
  | 'pending_payment'
  | 'paid'
  | 'in_atelier'
  | 'quality_check'
  | 'dispatched'
  | 'delivered'
  | 'cancelled';

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
  deliveryMethod: 'standard' | 'priority';
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
  orderNumber?: string;
  provider: string;
  providerOrderId: string;
  providerPaymentId: string | null;
  amount: number;
  currency: string;
  status: PaymentStatus;
  method: string;
  createdAt: string;
}

export interface LowStockItem {
  variantId: string;
  productId: string;
  productName: string;
  size: string;
  stock: number;
}

export interface AdminSummary {
  activeOrders: number;
  revenue: number;
  pendingPayments: number;
  lowStock: LowStockItem[];
  recentOrders: Order[];
}

export interface SocialStat {
  source: string;
  total: number;
  last7: number;
  last30: number;
  lastScanAt: string;
}

export interface LinkClickStat {
  link: string;
  /** QR scan source the visitor arrived from, or null for direct/untagged visits. */
  source: string | null;
  total: number;
  last7: number;
  last30: number;
  lastClickAt: string;
}

/** Mirrors backend/src/services/analytics.service.ts summary() — GET /api/analytics/summary. */
export interface AnalyticsSummary {
  kpis: {
    sessions: number;
    orders: number;
    revenue: number; // paise
    conversionRate: number; // fraction 0..1
    cartAbandonmentRate: number; // fraction 0..1
    aov: number;
  };
  funnel: Array<{ stage: string; sessions: number }>;
  trend: Array<{ day: string; sessions: number; orders: number }>;
  topProducts: Array<{ productId: string; name: string; views: number; carts: number; purchased: number }>;
  topSearches: Array<{ query: string; searches: number; lastAt: string }>;
  zeroSearches: Array<{ query: string; searches: number; lastAt: string }>;
  sources: Array<{ source: string; sessions: number }>;
  devices: Array<{ device: string; sessions: number }>;
  sizes: Array<{ size: string; adds: number }>;
  colors: Array<{ color: string; adds: number }>;
}

/** Valid next order-status transitions, mirrored from the backend state machine. */
export const ORDER_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: ['paid', 'cancelled'],
  paid: ['in_atelier', 'cancelled'],
  in_atelier: ['quality_check'],
  quality_check: ['dispatched'],
  dispatched: ['delivered'],
  delivered: [],
  cancelled: [],
};

export const ORDER_STATUSES: OrderStatus[] = [
  'pending_payment',
  'paid',
  'in_atelier',
  'quality_check',
  'dispatched',
  'delivered',
  'cancelled',
];

export const ORDER_STATUS_LABELS: Record<OrderStatus, string> = {
  pending_payment: 'Pending Payment',
  paid: 'Paid',
  in_atelier: 'In the Atelier',
  quality_check: 'Quality Check',
  dispatched: 'Dispatched',
  delivered: 'Delivered',
  cancelled: 'Cancelled',
};
