// Mirrors backend/src/types.ts response shapes. All money values are integer paise.

export type Role = 'customer' | 'admin';

export interface PublicUser {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: Role;
}

export type AuthProvider = 'password' | 'google' | 'otp';

export interface AdminUser {
  id: string;
  email: string | null;
  phone: string | null;
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
  deliveryMethod: 'standard' | 'priority';
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

export type DocumentKind = 'bill' | 'measurement' | 'shipping_receipt';

export type DocumentStatus = 'uploaded' | 'parsed' | 'confirmed' | 'discarded';

/** Mirrors GET /api/admin/orders/:id/documents rows. */
export interface DocumentSummary {
  id: string;
  kind: DocumentKind;
  status: DocumentStatus;
  createdAt: string;
}

export const DOCUMENT_KIND_LABELS: Record<DocumentKind, string> = {
  bill: 'Bill',
  measurement: 'Measurements',
  shipping_receipt: 'Shipping receipt',
};

/** Mirrors GET /api/admin/measurements rows. */
export interface MeasurementSet {
  id: string;
  userId: string;
  orderId: string | null;
  documentId: string | null;
  label: string;
  data: Record<string, string>;
  notes: string;
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
  revenueByChannel: Partial<Record<OrderChannel, number>>;
  revenueByBillType: Partial<Record<BillType, number>>;
  /** SUM(total − advancePaid) over open offline orders, paise. */
  pendingToCollect: number;
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

export const CHANNELS: OrderChannel[] = ['online', 'in_store', 'instagram', 'exhibition'];

/** Channels an offline bill can be entered under (everything but online). */
export const OFFLINE_CHANNELS: Exclude<OrderChannel, 'online'>[] = ['in_store', 'instagram', 'exhibition'];

export const CHANNEL_LABELS: Record<OrderChannel, string> = {
  online: 'Online',
  in_store: 'In Store',
  instagram: 'Instagram',
  exhibition: 'Exhibition',
};

export const BILL_TYPE_LABELS: Record<BillType, string> = {
  gst_invoice: 'GST Invoice',
  cash_memo: 'Cash Memo',
};

/**
 * Offline machine, mirrored from the backend: bills start in production and
 * remain cancellable (a bookkeeping correction — no restock) until dispatch.
 */
const OFFLINE_TRANSITIONS: Record<OrderStatus, OrderStatus[]> = {
  pending_payment: [],
  paid: [],
  in_atelier: ['quality_check', 'cancelled'],
  quality_check: ['dispatched', 'cancelled'],
  dispatched: ['delivered'],
  delivered: [],
  cancelled: [],
};

/** Valid next statuses for an order, channel-aware. */
export function transitionsFor(order: Order): OrderStatus[] {
  return order.channel === 'online' ? ORDER_TRANSITIONS[order.status] : OFFLINE_TRANSITIONS[order.status];
}

/** Whether the order can still be cancelled from its current status. */
export function cancellableFrom(order: Order): boolean {
  return transitionsFor(order).includes('cancelled');
}
