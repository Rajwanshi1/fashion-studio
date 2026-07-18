import type { NewOrder, NewOrderItem, OrdersRepo } from '../src/data/orders.repo';
import type { AdminPayment, CreatePaymentInput, PaymentsRepo } from '../src/data/payments.repo';
import type {
  AdminProduct,
  CreateCategoryInput,
  CreateProductInput,
  ProductsRepo,
  UpdateProductInput,
  VariantForOrder,
  WishlistRepo,
} from '../src/data/products.repo';
import type { ClicksRepo, LinkStats } from '../src/data/clicks.repo';
import type {
  ColorRow,
  DeviceRow,
  EventsRepo,
  KpiAndFunnel,
  NewEvent,
  SearchRow,
  SizeRow,
  SourceRow,
  TopProduct,
  TrendDay,
} from '../src/data/events.repo';
import type { ScansRepo, SourceStats } from '../src/data/scans.repo';
import type { AdminUser, CreateUserInput, UsersRepo } from '../src/data/users.repo';
import type { GoogleTokenClaims, VerifyGoogleToken } from '../src/services/auth.service';
import type { PaymentProvider } from '../src/services/payments.service';
import {
  Category,
  DomainError,
  Order,
  OrderItem,
  OrderStatus,
  Payment,
  PaymentStatus,
  ProductFilter,
  ProductSummary,
  Role,
  Tx,
  TxRunner,
  User,
  Variant,
} from '../src/types';

export const fakeTx: TxRunner = <T>(fn: (tx: Tx) => Promise<T>) => fn({});

let idCounter = 0;
const nextId = (prefix: string) => `${prefix}-${++idCounter}`;

export class FakeUsersRepo implements UsersRepo {
  users: User[] = [];
  private clock = 0;

  constructor(private ordersRepo?: FakeOrdersRepo) {}

  async create(input: CreateUserInput): Promise<User> {
    if (this.users.some((u) => u.email.toLowerCase() === input.email.toLowerCase())) {
      throw new DomainError('EMAIL_TAKEN', 'An account with this email already exists');
    }
    const user: User = {
      id: nextId('user'),
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role ?? 'customer',
      authProvider: input.authProvider ?? 'password',
      createdAt: new Date(Date.UTC(2026, 0, 1) + ++this.clock * 60_000).toISOString(),
    };
    this.users.push(user);
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.find((u) => u.email.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }

  private toAdmin(u: User): AdminUser {
    return {
      id: u.id,
      email: u.email,
      firstName: u.firstName,
      lastName: u.lastName,
      role: u.role,
      authProvider: u.authProvider,
      createdAt: u.createdAt,
      ordersCount: this.ordersRepo?.orders.filter((o) => o.userId === u.id).length ?? 0,
    };
  }

  async listAdmin(): Promise<AdminUser[]> {
    return [...this.users]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((u) => this.toAdmin(u));
  }

  async updateRole(id: string, role: Role): Promise<AdminUser | null> {
    const u = this.users.find((x) => x.id === id);
    if (!u) return null;
    u.role = role;
    return this.toAdmin(u);
  }
}

export class FakeGoogleVerifier {
  /** credential string → claims returned when that credential is verified. */
  tokens = new Map<string, GoogleTokenClaims>();

  issue(credential: string, claims: GoogleTokenClaims): void {
    this.tokens.set(credential, claims);
  }

  verify: VerifyGoogleToken = async (credential) => {
    const claims = this.tokens.get(credential);
    if (!claims) throw new Error('invalid Google credential');
    return claims;
  };
}

function toSummary(p: AdminProduct): ProductSummary {
  return {
    id: p.id,
    slug: p.slug,
    name: p.name,
    price: p.price,
    color: p.color,
    flag: p.flag,
    imageUrl: p.imageUrl,
    categorySlug: p.categorySlug,
    categoryName: p.categoryName,
  };
}

export class FakeProductsRepo implements ProductsRepo {
  categories: Category[] = [];
  products: AdminProduct[] = [];
  private clock = 0;

  addCategory(input: Partial<CreateCategoryInput> & { slug: string; name: string }): Category {
    const category: Category = {
      id: nextId('cat'),
      slug: input.slug,
      name: input.name,
      description: input.description ?? '',
      position: input.position ?? this.categories.length + 1,
    };
    this.categories.push(category);
    return category;
  }

  async listCategories(): Promise<Category[]> {
    return [...this.categories]
      .sort((a, b) => a.position - b.position)
      .map((c) => ({
        ...c,
        productCount: this.products.filter((p) => p.categoryId === c.id && p.active).length,
      }));
  }

  async listProducts(filter: ProductFilter): Promise<{ items: ProductSummary[]; total: number }> {
    let rows = this.products.filter((p) => p.active);
    if (filter.categorySlug) rows = rows.filter((p) => p.categorySlug === filter.categorySlug);
    if (filter.search) {
      const q = filter.search.toLowerCase();
      rows = rows.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.description.toLowerCase().includes(q) ||
          p.color.toLowerCase().includes(q),
      );
    }
    const flagRank = (p: AdminProduct) => (p.flag === 'bestseller' ? 0 : p.flag === 'new' ? 1 : 2);
    const sorted = [...rows];
    switch (filter.sort ?? 'featured') {
      case 'new':
        sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
        break;
      case 'price_asc':
        sorted.sort((a, b) => a.price - b.price);
        break;
      case 'price_desc':
        sorted.sort((a, b) => b.price - a.price);
        break;
      default:
        sorted.sort((a, b) => flagRank(a) - flagRank(b) || a.createdAt.localeCompare(b.createdAt));
    }
    const start = (filter.page - 1) * filter.limit;
    return { items: sorted.slice(start, start + filter.limit).map(toSummary), total: sorted.length };
  }

  async getBySlug(slug: string): Promise<AdminProduct | null> {
    const p = this.products.find((x) => x.slug === slug);
    return p ? structuredClone(p) : null;
  }

  async getRelated(productId: string, categoryId: string, limit: number): Promise<ProductSummary[]> {
    return this.products
      .filter((p) => p.active && p.categoryId === categoryId && p.id !== productId)
      .sort((a, b) => Number(b.flag !== null) - Number(a.flag !== null) || a.createdAt.localeCompare(b.createdAt))
      .slice(0, limit)
      .map(toSummary);
  }

  async getVariantsForUpdate(_tx: Tx, variantIds: string[]): Promise<VariantForOrder[]> {
    const found: VariantForOrder[] = [];
    for (const p of this.products) {
      for (const v of p.variants) {
        if (variantIds.includes(v.id)) {
          found.push({
            id: v.id,
            productId: p.id,
            size: v.size,
            stock: v.stock,
            productName: p.name,
            color: p.color,
            unitPrice: p.price,
            imageUrl: p.imageUrl,
          });
        }
      }
    }
    return found;
  }

  private variantById(variantId: string): Variant | null {
    for (const p of this.products) {
      const v = p.variants.find((x) => x.id === variantId);
      if (v) return v;
    }
    return null;
  }

  async decrementStock(_tx: Tx, variantId: string, qty: number): Promise<void> {
    const v = this.variantById(variantId);
    if (!v) throw new Error(`unknown variant ${variantId}`);
    if (v.stock - qty < 0) throw new Error('stock check constraint violated');
    v.stock -= qty;
  }

  async restock(_tx: Tx, variantId: string, qty: number): Promise<void> {
    const v = this.variantById(variantId);
    if (!v) throw new Error(`unknown variant ${variantId}`);
    v.stock += qty;
  }

  async createCategory(input: CreateCategoryInput): Promise<Category> {
    const existing = this.categories.find((c) => c.slug === input.slug);
    if (existing) {
      Object.assign(existing, input);
      return existing;
    }
    return this.addCategory(input);
  }

  async createProduct(input: CreateProductInput): Promise<AdminProduct> {
    const category = this.categories.find((c) => c.id === input.categoryId);
    if (!category) throw new DomainError('NOT_FOUND', 'Category not found');
    const id = nextId('p');
    const sizes = input.variants ?? ['XS', 'S', 'M', 'L', 'XL', 'Custom'].map((size) => ({ size, stock: 0 }));
    const product: AdminProduct = {
      id,
      slug: input.slug,
      name: input.name,
      price: input.price,
      color: input.color ?? '',
      flag: input.flag ?? null,
      imageUrl: input.imageUrl ?? null,
      categorySlug: category.slug,
      categoryName: category.name,
      description: input.description ?? '',
      details: input.details ?? '',
      active: input.active ?? true,
      variants: sizes.map((v) => ({ id: nextId('v'), productId: id, size: v.size, stock: v.stock })),
      categoryId: category.id,
      createdAt: new Date(Date.UTC(2026, 0, 1) + ++this.clock * 60_000).toISOString(),
    };
    this.products.push(product);
    return structuredClone(product);
  }

  async updateProduct(id: string, input: UpdateProductInput): Promise<AdminProduct | null> {
    const p = this.products.find((x) => x.id === id);
    if (!p) return null;
    if (input.categoryId !== undefined) {
      const category = this.categories.find((c) => c.id === input.categoryId);
      if (!category) throw new DomainError('NOT_FOUND', 'Category not found');
      p.categoryId = category.id;
      p.categorySlug = category.slug;
      p.categoryName = category.name;
    }
    for (const key of ['slug', 'name', 'description', 'details', 'price', 'color', 'flag', 'imageUrl', 'active'] as const) {
      if (input[key] !== undefined) (p as any)[key] = input[key];
    }
    return structuredClone(p);
  }

  async setVariantStock(variantId: string, stock: number): Promise<Variant | null> {
    const v = this.variantById(variantId);
    if (!v) return null;
    v.stock = stock;
    return { ...v };
  }

  async listAllProducts(): Promise<AdminProduct[]> {
    return [...this.products]
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((p) => structuredClone(p));
  }
}

export class FakeWishlistRepo implements WishlistRepo {
  entries: { userId: string; productId: string; at: number }[] = [];
  private clock = 0;

  constructor(private productsRepo: FakeProductsRepo) {}

  async list(userId: string): Promise<ProductSummary[]> {
    return this.entries
      .filter((e) => e.userId === userId)
      .sort((a, b) => b.at - a.at)
      .map((e) => this.productsRepo.products.find((p) => p.id === e.productId))
      .filter((p): p is AdminProduct => !!p && p.active)
      .map(toSummary);
  }

  async add(userId: string, productId: string): Promise<void> {
    if (!this.productsRepo.products.some((p) => p.id === productId)) {
      throw new DomainError('NOT_FOUND', 'Product not found');
    }
    if (!this.entries.some((e) => e.userId === userId && e.productId === productId)) {
      this.entries.push({ userId, productId, at: ++this.clock });
    }
  }

  async remove(userId: string, productId: string): Promise<void> {
    this.entries = this.entries.filter((e) => !(e.userId === userId && e.productId === productId));
  }
}

export class FakeOrdersRepo implements OrdersRepo {
  orders: Order[] = [];
  private seq = 4818;
  private clock = 0;

  async createWithItems(_tx: Tx, order: NewOrder, items: NewOrderItem[]): Promise<Order> {
    const id = nextId('o');
    const created: Order = {
      id,
      orderNumber: order.orderNumber,
      userId: order.userId,
      email: order.email,
      phone: order.phone,
      firstName: order.firstName,
      lastName: order.lastName,
      addressLine1: order.addressLine1,
      addressLine2: order.addressLine2,
      city: order.city,
      state: order.state,
      pincode: order.pincode,
      country: order.country,
      deliveryMethod: order.deliveryMethod,
      deliveryFee: order.deliveryFee,
      subtotal: order.subtotal,
      total: order.total,
      status: order.status,
      createdAt: new Date(Date.UTC(2026, 5, 1) + ++this.clock * 60_000).toISOString(),
      items: items.map((it): OrderItem => ({ ...it, id: nextId('oi') })),
    };
    this.orders.push(created);
    return structuredClone(created);
  }

  async getByNumber(orderNumber: string): Promise<Order | null> {
    const o = this.orders.find((x) => x.orderNumber === orderNumber);
    return o ? structuredClone(o) : null;
  }

  async getById(id: string, _tx?: Tx): Promise<Order | null> {
    const o = this.orders.find((x) => x.id === id);
    return o ? structuredClone(o) : null;
  }

  async listByUser(userId: string): Promise<Order[]> {
    return this.orders
      .filter((o) => o.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((o) => structuredClone(o));
  }

  async listAdmin(status?: OrderStatus): Promise<Order[]> {
    return this.orders
      .filter((o) => !status || o.status === status)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((o) => structuredClone(o));
  }

  async updateStatus(id: string, status: OrderStatus, _tx?: Tx): Promise<Order | null> {
    const o = this.orders.find((x) => x.id === id);
    if (!o) return null;
    o.status = status;
    return structuredClone(o);
  }

  async nextOrderNumber(_tx: Tx): Promise<string> {
    return `TA-2026-${String(this.seq++).padStart(5, '0')}`;
  }
}

export class FakePaymentsRepo implements PaymentsRepo {
  payments: Payment[] = [];
  private clock = 0;

  constructor(private ordersRepo: FakeOrdersRepo) {}

  async create(input: CreatePaymentInput): Promise<Payment> {
    const payment: Payment = {
      id: nextId('pay'),
      orderId: input.orderId,
      provider: input.provider,
      providerOrderId: input.providerOrderId,
      providerPaymentId: null,
      amount: input.amount,
      currency: input.currency,
      status: input.status,
      method: input.method,
      createdAt: new Date(Date.UTC(2026, 5, 2) + ++this.clock * 60_000).toISOString(),
    };
    this.payments.push(payment);
    return { ...payment };
  }

  async getById(id: string): Promise<Payment | null> {
    const p = this.payments.find((x) => x.id === id);
    return p ? { ...p } : null;
  }

  async updateStatus(id: string, status: PaymentStatus, providerPaymentId?: string): Promise<Payment | null> {
    const p = this.payments.find((x) => x.id === id);
    if (!p) return null;
    p.status = status;
    if (providerPaymentId !== undefined) p.providerPaymentId = providerPaymentId;
    return { ...p };
  }

  async listAdmin(): Promise<AdminPayment[]> {
    return [...this.payments]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((p) => ({
        ...p,
        orderNumber: this.ordersRepo.orders.find((o) => o.id === p.orderId)?.orderNumber ?? '',
      }));
  }

  async getByOrderId(orderId: string): Promise<Payment[]> {
    return this.payments
      .filter((p) => p.orderId === orderId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((p) => ({ ...p }));
  }
}

export class FakePaymentProvider implements PaymentProvider {
  keyId = 'rzp_test_MASKED';
  calls: { amountPaise: number; receipt: string }[] = [];
  private seq = 0;

  async createProviderOrder(amountPaise: number, receipt: string): Promise<{ providerOrderId: string }> {
    this.calls.push({ amountPaise, receipt });
    return { providerOrderId: `order_MOCK_fake_${++this.seq}` };
  }
}

interface FakeScanRow {
  source: string;
  userAgent: string | null;
  referer: string | null;
  createdAt: string;
}

export class FakeScansRepo implements ScansRepo {
  scans: FakeScanRow[] = [];

  async insert(source: string, userAgent: string | null, referer: string | null): Promise<void> {
    this.scans.push({ source, userAgent, referer, createdAt: new Date().toISOString() });
  }

  async statsBySource(): Promise<SourceStats[]> {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const bySource = new Map<string, FakeScanRow[]>();
    for (const row of this.scans) {
      const list = bySource.get(row.source) ?? [];
      list.push(row);
      bySource.set(row.source, list);
    }
    return [...bySource.entries()]
      .map(([source, rows]) => ({
        source,
        total: rows.length,
        last7: rows.filter((r) => now - new Date(r.createdAt).getTime() <= 7 * DAY_MS).length,
        last30: rows.filter((r) => now - new Date(r.createdAt).getTime() <= 30 * DAY_MS).length,
        lastScanAt: rows.map((r) => r.createdAt).sort().at(-1)!,
      }))
      .sort((a, b) => b.total - a.total);
  }
}

interface FakeClickRow {
  link: string;
  source: string | null;
  userAgent: string | null;
  referer: string | null;
  createdAt: string;
}

export class FakeClicksRepo implements ClicksRepo {
  clicks: FakeClickRow[] = [];

  async insert(link: string, source: string | null, userAgent: string | null, referer: string | null): Promise<void> {
    this.clicks.push({ link, source, userAgent, referer, createdAt: new Date().toISOString() });
  }

  async statsByLink(): Promise<LinkStats[]> {
    const DAY_MS = 24 * 60 * 60 * 1000;
    const now = Date.now();
    const byKey = new Map<string, FakeClickRow[]>();
    for (const row of this.clicks) {
      const key = `${row.link} ${row.source ?? ''}`;
      const list = byKey.get(key) ?? [];
      list.push(row);
      byKey.set(key, list);
    }
    return [...byKey.values()]
      .map((rows) => ({
        link: rows[0].link,
        source: rows[0].source,
        total: rows.length,
        last7: rows.filter((r) => now - new Date(r.createdAt).getTime() <= 7 * DAY_MS).length,
        last30: rows.filter((r) => now - new Date(r.createdAt).getTime() <= 30 * DAY_MS).length,
        lastClickAt: rows.map((r) => r.createdAt).sort().at(-1)!,
      }))
      .sort((a, b) => b.total - a.total);
  }
}

type StoredEvent = NewEvent & { createdAt: Date };

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * In-memory stand-in for the aggregate reads. Rows are timestamped at insert
 * time (like FakeScansRepo/FakeClicksRepo) so `days`-windowing is meaningful;
 * everything inserted during a test run falls inside any 7/30/90 window.
 * `productNames` lets a test opt into name resolution for topProducts, mirroring
 * the real repo's `LEFT JOIN products`.
 */
export class FakeEventsRepo implements EventsRepo {
  rows: StoredEvent[] = [];
  productNames = new Map<string, string>();

  async insertBatch(rows: NewEvent[]): Promise<void> {
    const now = new Date();
    this.rows.push(...rows.map((r) => ({ ...r, createdAt: now })));
  }

  private within(days: number): StoredEvent[] {
    const cutoff = Date.now() - days * DAY_MS;
    return this.rows.filter((r) => r.createdAt.getTime() > cutoff);
  }

  async kpiAndFunnel(days: number): Promise<KpiAndFunnel> {
    const rows = this.within(days);
    const distinctSessions = (type: string) =>
      new Set(rows.filter((r) => r.eventType === type).map((r) => r.sessionId)).size;
    const orderRows = rows.filter((r) => r.eventType === 'order_placed');
    const revenue = orderRows.reduce((sum, r) => sum + Number((r.props as any)?.total ?? 0), 0);
    return {
      sessions: distinctSessions('session_start'),
      pdpSessions: distinctSessions('product_view'),
      cartSessions: distinctSessions('add_to_cart'),
      checkoutSessions: distinctSessions('checkout_start'),
      orderSessions: distinctSessions('order_placed'),
      orders: orderRows.length,
      revenue,
    };
  }

  async dailyTrend(days: number): Promise<TrendDay[]> {
    const rows = this.within(days);
    const byDay = new Map<string, { sessions: Set<string>; orders: number }>();
    const today = new Date();
    for (let i = days - 1; i >= 0; i--) {
      const d = new Date(today);
      d.setUTCDate(d.getUTCDate() - i);
      byDay.set(d.toISOString().slice(0, 10), { sessions: new Set(), orders: 0 });
    }
    for (const r of rows) {
      const bucket = byDay.get(r.createdAt.toISOString().slice(0, 10));
      if (!bucket) continue;
      if (r.eventType === 'session_start') bucket.sessions.add(r.sessionId);
      if (r.eventType === 'order_placed') bucket.orders++;
    }
    return [...byDay.entries()].map(([day, v]) => ({ day, sessions: v.sessions.size, orders: v.orders }));
  }

  async topProducts(days: number): Promise<TopProduct[]> {
    const rows = this.within(days);
    const views = new Map<string, number>();
    const carts = new Map<string, number>();
    const purchased = new Map<string, number>();
    for (const r of rows) {
      if (!r.productId) continue;
      if (r.eventType === 'product_view') views.set(r.productId, (views.get(r.productId) ?? 0) + 1);
      if (r.eventType === 'add_to_cart') carts.set(r.productId, (carts.get(r.productId) ?? 0) + 1);
    }
    for (const r of rows) {
      if (r.eventType !== 'order_placed') continue;
      const items = ((r.props as any)?.items ?? []) as { productId?: string; qty?: number }[];
      for (const item of items) {
        if (!item.productId) continue;
        purchased.set(item.productId, (purchased.get(item.productId) ?? 0) + (item.qty ?? 0));
      }
    }
    const ids = new Set([...views.keys(), ...carts.keys(), ...purchased.keys()]);
    return [...ids]
      .map((productId) => ({
        productId,
        name: this.productNames.get(productId) ?? '(removed product)',
        views: views.get(productId) ?? 0,
        carts: carts.get(productId) ?? 0,
        purchased: purchased.get(productId) ?? 0,
      }))
      .sort((a, b) => b.views - a.views || b.carts - a.carts)
      .slice(0, 10);
  }

  private searchGroups(days: number, zeroOnly: boolean): SearchRow[] {
    const groups = new Map<string, { searches: number; lastAt: Date }>();
    for (const r of this.within(days)) {
      if (r.eventType !== 'search') continue;
      const props = r.props as any;
      if (props?.query === undefined) continue;
      if (zeroOnly && Number(props?.results) !== 0) continue;
      const g = groups.get(props.query) ?? { searches: 0, lastAt: r.createdAt };
      g.searches++;
      if (r.createdAt > g.lastAt) g.lastAt = r.createdAt;
      groups.set(props.query, g);
    }
    return [...groups.entries()]
      .map(([query, g]) => ({ query, searches: g.searches, lastAt: g.lastAt.toISOString() }))
      .sort((a, b) => b.searches - a.searches)
      .slice(0, 20);
  }

  async topSearches(days: number): Promise<SearchRow[]> {
    return this.searchGroups(days, false);
  }

  async zeroSearches(days: number): Promise<SearchRow[]> {
    return this.searchGroups(days, true);
  }

  async sources(days: number): Promise<SourceRow[]> {
    const counts = new Map<string, Set<string>>();
    for (const r of this.within(days)) {
      if (r.eventType !== 'session_start') continue;
      const props = r.props as any;
      let source = 'direct';
      if (props?.utmSource) {
        source = props.utmSource;
      } else if (props?.referrer) {
        const match = /^https?:\/\/([^/]+)/.exec(props.referrer);
        source = match ? match[1] : 'direct';
      }
      const set = counts.get(source) ?? new Set<string>();
      set.add(r.sessionId);
      counts.set(source, set);
    }
    return [...counts.entries()]
      .map(([source, sessions]) => ({ source, sessions: sessions.size }))
      .sort((a, b) => b.sessions - a.sessions)
      .slice(0, 20);
  }

  async devices(days: number): Promise<DeviceRow[]> {
    const counts = new Map<string, Set<string>>();
    for (const r of this.within(days)) {
      if (r.eventType !== 'session_start') continue;
      const set = counts.get(r.device) ?? new Set<string>();
      set.add(r.sessionId);
      counts.set(r.device, set);
    }
    return [...counts.entries()]
      .map(([device, sessions]) => ({ device, sessions: sessions.size }))
      .sort((a, b) => b.sessions - a.sessions);
  }

  async sizes(days: number): Promise<SizeRow[]> {
    const counts = new Map<string, number>();
    for (const r of this.within(days)) {
      if (r.eventType !== 'add_to_cart') continue;
      const size = (r.props as any)?.size;
      if (size === undefined) continue;
      counts.set(size, (counts.get(size) ?? 0) + 1);
    }
    return [...counts.entries()].map(([size, adds]) => ({ size, adds })).sort((a, b) => b.adds - a.adds);
  }

  async colors(days: number): Promise<ColorRow[]> {
    const counts = new Map<string, number>();
    for (const r of this.within(days)) {
      if (r.eventType !== 'add_to_cart') continue;
      const color = (r.props as any)?.color;
      if (color === undefined) continue;
      counts.set(color, (counts.get(color) ?? 0) + 1);
    }
    return [...counts.entries()].map(([color, adds]) => ({ color, adds })).sort((a, b) => b.adds - a.adds);
  }
}

export interface Fakes {
  users: FakeUsersRepo;
  products: FakeProductsRepo;
  wishlist: FakeWishlistRepo;
  orders: FakeOrdersRepo;
  payments: FakePaymentsRepo;
  scans: FakeScansRepo;
  clicks: FakeClicksRepo;
  events: FakeEventsRepo;
}

export function makeFakes(): Fakes {
  const products = new FakeProductsRepo();
  const wishlist = new FakeWishlistRepo(products);
  const orders = new FakeOrdersRepo();
  const users = new FakeUsersRepo(orders);
  const payments = new FakePaymentsRepo(orders);
  const scans = new FakeScansRepo();
  const clicks = new FakeClicksRepo();
  const events = new FakeEventsRepo();
  return { users, products, wishlist, orders, payments, scans, clicks, events };
}

/** Small catalog covering both categories, all flags, an inactive product and low stock. */
export async function seedCatalog(products: FakeProductsRepo) {
  const lehengas = products.addCategory({ slug: 'lehenga-sets', name: 'Lehenga Sets', position: 1 });
  const gowns = products.addCategory({ slug: 'gowns', name: 'Gowns', position: 2 });

  const sage = await products.createProduct({
    categoryId: lehengas.id,
    slug: 'sage-sequin-jacket-lehenga',
    name: 'Sage Sequin Jacket Lehenga',
    description: 'Hand-embroidered jacket lehenga in moss-sage tissue.',
    details: 'Dry clean only',
    price: 18400000,
    color: 'Sage',
    flag: 'bestseller',
    variants: [
      { size: 'M', stock: 3 },
      { size: 'Custom', stock: 50 },
    ],
  });
  const moss = await products.createProduct({
    categoryId: gowns.id,
    slug: 'moss-tissue-draped-gown',
    name: 'Moss Tissue Draped Gown',
    description: 'A single length of moss tissue, draped.',
    details: 'Dry clean only',
    price: 9600000,
    color: 'Moss',
    flag: 'new',
    variants: [{ size: 'S', stock: 1 }],
  });
  const plain = await products.createProduct({
    categoryId: lehengas.id,
    slug: 'celadon-tissue-draped-lehenga',
    name: 'Celadon Tissue Draped Lehenga',
    description: 'Pre-draped celadon tissue lehenga.',
    details: 'Dry clean only',
    price: 16800000,
    color: 'Celadon',
    flag: null,
    variants: [{ size: 'L', stock: 5 }],
  });
  const inactive = await products.createProduct({
    categoryId: lehengas.id,
    slug: 'archived-lehenga',
    name: 'Archived Lehenga',
    description: 'No longer offered.',
    details: '',
    price: 9900000,
    color: 'Forest',
    flag: null,
    active: false,
    variants: [{ size: 'M', stock: 2 }],
  });

  return { lehengas, gowns, sage, moss, plain, inactive };
}
