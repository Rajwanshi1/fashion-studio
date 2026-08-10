import type {
  AdminOrdersFilter,
  NewOfflineItem,
  NewOfflineOrder,
  NewOrder,
  NewOrderItem,
  OrderDetailsPatch,
  OrdersRepo,
} from '../src/data/orders.repo';
import type { CreateReceiptInput, ReceiptsRepo } from '../src/data/receipts.repo';
import type { AdminPayment, CreatePaymentInput, PaymentsRepo } from '../src/data/payments.repo';
import type {
  AdminProduct,
  BulkDeleteResult,
  BulkProductAction,
  BulkUpdateResult,
  CreateCategoryInput,
  CreateProductInput,
  ProductsRepo,
  UpdateProductInput,
  VariantForOrder,
  WishlistRepo,
} from '../src/data/products.repo';
import type { ClicksRepo, LinkStats } from '../src/data/clicks.repo';
import type {
  CreateDocumentInput,
  DocumentRow,
  DocumentStatus,
  DocumentsRepo,
} from '../src/data/documents.repo';
import type {
  CreateMeasurementInput,
  MeasurementRow,
  MeasurementsRepo,
} from '../src/data/measurements.repo';
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
import type { OtpRecord, OtpsRepo } from '../src/data/otps.repo';
import type { ScansRepo, SourceStats } from '../src/data/scans.repo';
import type { AdminUser, CreateUserInput, UsersRepo } from '../src/data/users.repo';
import type { BillParser, ParseKind } from '../src/services/ai/parser';
import type { GoogleTokenClaims, VerifyGoogleToken } from '../src/services/auth.service';
import type { ObjectStore } from '../src/services/objectstore';
import type { PaymentProvider } from '../src/services/payments.service';
import type { SmsProvider } from '../src/services/sms.provider';
import type { InvoiceVars, WhatsAppProvider } from '../src/services/whatsapp.provider';
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
  Receipt,
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
    if (input.email && this.users.some((u) => u.email?.toLowerCase() === input.email!.toLowerCase())) {
      throw new DomainError('EMAIL_TAKEN', 'An account with this email already exists');
    }
    if (input.phone && this.users.some((u) => u.phone === input.phone)) {
      throw new DomainError('PHONE_TAKEN', 'An account with this phone number already exists');
    }
    const user: User = {
      id: nextId('user'),
      email: input.email,
      passwordHash: input.passwordHash,
      firstName: input.firstName,
      lastName: input.lastName,
      role: input.role ?? 'customer',
      authProvider: input.authProvider ?? 'password',
      phone: input.phone ?? null,
      phoneVerified: input.phoneVerified ?? false,
      createdAt: new Date(Date.UTC(2026, 0, 1) + ++this.clock * 60_000).toISOString(),
    };
    this.users.push(user);
    return user;
  }

  async findByEmail(email: string): Promise<User | null> {
    return this.users.find((u) => u.email?.toLowerCase() === email.toLowerCase()) ?? null;
  }

  async findByPhone(phone: string): Promise<User | null> {
    return this.users.find((u) => u.phone === phone) ?? null;
  }

  async findById(id: string): Promise<User | null> {
    return this.users.find((u) => u.id === id) ?? null;
  }

  async setPhoneVerified(id: string): Promise<User | null> {
    const u = this.users.find((x) => x.id === id);
    if (!u) return null;
    u.phoneVerified = true;
    return u;
  }

  private toAdmin(u: User): AdminUser {
    return {
      id: u.id,
      email: u.email,
      phone: u.phone,
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

  async listWithPhone(): Promise<{ firstName: string; lastName: string; phone: string }[]> {
    return this.users
      .filter((u) => u.phone)
      .map((u) => ({ firstName: u.firstName, lastName: u.lastName, phone: u.phone! }))
      .sort((a, b) => a.firstName.localeCompare(b.firstName) || a.lastName.localeCompare(b.lastName));
  }

  async searchAdmin(phone?: string | null, q?: string | null): Promise<AdminUser[]> {
    if (!phone && !q) return [];
    const needle = q?.toLowerCase();
    const matchesQ = (u: User) =>
      !!needle &&
      ((u.email ?? '').toLowerCase().includes(needle) ||
        u.firstName.toLowerCase().includes(needle) ||
        u.lastName.toLowerCase().includes(needle));
    return this.users
      .filter((u) => (phone && u.phone === phone) || matchesQ(u))
      .sort(
        (a, b) =>
          Number(phone ? b.phone === phone : false) - Number(phone ? a.phone === phone : false) ||
          b.createdAt.localeCompare(a.createdAt),
      )
      .slice(0, 8)
      .map((u) => this.toAdmin(u));
  }

  async updateRole(id: string, role: Role): Promise<AdminUser | null> {
    const u = this.users.find((x) => x.id === id);
    if (!u) return null;
    u.role = role;
    return this.toAdmin(u);
  }
}

export class FakeOtpsRepo implements OtpsRepo {
  records: (OtpRecord & { createdAt: Date; consumedAt: Date | null })[] = [];

  async create(input: { phone: string; codeHash: string; expiresAt: Date }): Promise<OtpRecord> {
    const record = {
      id: nextId('otp'),
      phone: input.phone,
      codeHash: input.codeHash,
      expiresAt: input.expiresAt,
      attempts: 0,
      createdAt: new Date(input.expiresAt.getTime() - 5 * 60_000),
      consumedAt: null,
    };
    this.records.push(record);
    return { ...record };
  }

  async latestActiveForPhone(phone: string, now: Date): Promise<OtpRecord | null> {
    const active = this.records
      .filter((r) => r.phone === phone && !r.consumedAt && r.expiresAt > now)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    return active[0] ? { ...active[0] } : null;
  }

  async incrementAttempts(id: string): Promise<number> {
    const r = this.records.find((x) => x.id === id);
    if (!r) return Number.MAX_SAFE_INTEGER;
    return ++r.attempts;
  }

  async consume(id: string): Promise<void> {
    const r = this.records.find((x) => x.id === id);
    if (r) r.consumedAt = new Date();
  }

  async countRecentForPhone(phone: string, since: Date): Promise<number> {
    return this.records.filter((r) => r.phone === phone && r.createdAt > since).length;
  }
}

export class FakeSmsProvider implements SmsProvider {
  sent: { phone: string; code: string }[] = [];
  failWith: Error | null = null;

  async sendOtp(phone: string, code: string): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push({ phone, code });
  }
}

export class FakeWhatsAppProvider implements WhatsAppProvider {
  sent: { phone: string; filename: string; vars: InvoiceVars; bytes: number }[] = [];
  failWith: Error | null = null;

  async sendInvoice(phone: string, pdf: Buffer, filename: string, vars: InvoiceVars): Promise<void> {
    if (this.failWith) throw this.failWith;
    this.sent.push({ phone, filename, vars, bytes: pdf.length });
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
    collection: p.collection,
    occasion: p.occasion,
    dupattaPrice: p.dupattaPrice,
    jacketPrice: p.jacketPrice,
    colorFamily: p.colorFamily,
    salePrice: p.salePrice,
  };
}

/** Base price actually charged — mirrors the repo's EFFECTIVE_PRICE CASE. */
const effectivePrice = (p: AdminProduct) =>
  p.flag === 'sale' && p.salePrice != null ? p.salePrice : p.price;

/** Full-set price (effective base + default-included add-ons), mirroring the SQL price sort. */
const setPrice = (p: AdminProduct) => effectivePrice(p) + (p.dupattaPrice ?? 0) + (p.jacketPrice ?? 0);

type FakeProduct = AdminProduct & { deletedAt: string | null };

export class FakeProductsRepo implements ProductsRepo {
  categories: Category[] = [];
  products: FakeProduct[] = [];
  /** Product ids referenced by an order — mirrors the order_items FK guard. */
  orderedProductIds = new Set<string>();
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
    let rows = this.products.filter((p) => p.active && !p.deletedAt);
    if (filter.categorySlug) rows = rows.filter((p) => p.categorySlug === filter.categorySlug);
    if (filter.collection) rows = rows.filter((p) => p.collection === filter.collection);
    if (filter.colorFamily) rows = rows.filter((p) => p.colorFamily === filter.colorFamily);
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
        sorted.sort((a, b) => setPrice(a) - setPrice(b));
        break;
      case 'price_desc':
        sorted.sort((a, b) => setPrice(b) - setPrice(a));
        break;
      default:
        sorted.sort((a, b) => flagRank(a) - flagRank(b) || a.createdAt.localeCompare(b.createdAt));
    }
    const start = (filter.page - 1) * filter.limit;
    return { items: sorted.slice(start, start + filter.limit).map(toSummary), total: sorted.length };
  }

  async getBySlug(slug: string): Promise<AdminProduct | null> {
    const p = this.products.find((x) => x.slug === slug && !x.deletedAt);
    return p ? structuredClone(p) : null;
  }

  async getRelated(productId: string, categoryId: string, limit: number): Promise<ProductSummary[]> {
    return this.products
      .filter((p) => p.active && !p.deletedAt && p.categoryId === categoryId && p.id !== productId)
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
            // Mirrors the repo's sale CASE: checkout charges the sale price.
            unitPrice: effectivePrice(p),
            imageUrl: p.imageUrl,
            dupattaPrice: p.dupattaPrice,
            jacketPrice: p.jacketPrice,
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
    if (this.products.some((p) => p.slug === input.slug)) {
      throw new DomainError('SLUG_TAKEN', 'A piece with this slug already exists — choose a different slug');
    }
    const id = nextId('p');
    const sizes = input.variants ?? ['XS', 'S', 'M', 'L', 'XL', 'Custom'].map((size) => ({ size, stock: 0 }));
    const product: FakeProduct = {
      id,
      slug: input.slug,
      name: input.name,
      price: input.price,
      color: input.color ?? '',
      flag: input.flag ?? null,
      // A gallery owns the primary photo; imageUrl only applies without one.
      imageUrl: input.images ? (input.images[0]?.url ?? null) : (input.imageUrl ?? null),
      categorySlug: category.slug,
      categoryName: category.name,
      description: input.description ?? '',
      details: input.details ?? '',
      collection: input.collection ?? '',
      craft: input.craft ?? '',
      fabric: input.fabric ?? '',
      occasion: input.occasion ?? '',
      dupattaPrice: input.dupattaPrice ?? null,
      jacketPrice: input.jacketPrice ?? null,
      colorFamily: input.colorFamily ?? null,
      salePrice: input.salePrice ?? null,
      costPrice: input.costPrice ?? null,
      images: (input.images ?? []).map((im) => ({ url: im.url, pose: im.pose ?? '' })),
      active: input.active ?? true,
      variants: sizes.map((v) => ({ id: nextId('v'), productId: id, size: v.size, stock: v.stock })),
      categoryId: category.id,
      createdAt: new Date(Date.UTC(2026, 0, 1) + ++this.clock * 60_000).toISOString(),
      deletedAt: null,
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
    const keys = [
      'name', 'description', 'details', 'price', 'color', 'flag', 'imageUrl', 'active',
      'collection', 'craft', 'fabric', 'occasion', 'dupattaPrice', 'jacketPrice',
      'salePrice', 'costPrice', 'colorFamily',
    ] as const;
    for (const key of keys) {
      if (input[key] !== undefined) (p as any)[key] = input[key];
    }
    // A gallery is replaced wholesale and re-points the primary photo.
    if (input.images !== undefined) {
      p.images = input.images.map((im) => ({ url: im.url, pose: im.pose ?? '' }));
      p.imageUrl = p.images[0]?.url ?? null;
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
    return this.products
      .filter((p) => !p.deletedAt)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((p) => structuredClone(p));
  }

  async listCollections(): Promise<string[]> {
    const names = new Set(
      this.products
        .filter((p) => p.active && !p.deletedAt && p.collection !== '')
        .map((p) => p.collection),
    );
    return [...names].sort();
  }

  async bulkDelete(ids: string[]): Promise<BulkDeleteResult> {
    const deleted: string[] = [];
    const archived: string[] = [];
    for (const id of ids) {
      const p = this.products.find((x) => x.id === id && !x.deletedAt);
      if (!p) continue;
      if (this.orderedProductIds.has(id)) {
        p.deletedAt = new Date().toISOString();
        p.active = false;
        p.slug = `${p.slug}-archived-20260101000000`;
        archived.push(id);
      } else {
        this.products = this.products.filter((x) => x.id !== id);
        deleted.push(id);
      }
    }
    return { deleted, archived };
  }

  async bulkUpdate(ids: string[], action: BulkProductAction): Promise<BulkUpdateResult> {
    const updated: string[] = [];
    const skipped: string[] = [];
    const notFound: string[] = [];
    for (const id of ids) {
      const p = this.products.find((x) => x.id === id && !x.deletedAt);
      if (!p) {
        notFound.push(id);
        continue;
      }
      if (!applyBulkAction(p, action)) {
        skipped.push(id);
        continue;
      }
      updated.push(id);
    }
    return { updated, skipped, notFound };
  }
}

/**
 * Mirrors the SQL in products.repo.ts, including the whole-rupee rounding and
 * the 0 < sale_price < price guard. Returns false when the action doesn't apply.
 */
function applyBulkAction(p: FakeProduct, action: BulkProductAction): boolean {
  switch (action.type) {
    case 'sale': {
      const sale = Math.round((p.price * (100 - action.discountPct)) / 10000) * 100;
      if (sale < 1 || sale > p.price - 1) return false;
      p.flag = 'sale';
      p.salePrice = sale;
      return true;
    }
    case 'end_sale':
      if (p.flag !== 'sale') return false;
      p.flag = null;
      p.salePrice = null;
      return true;
    case 'visibility':
      p.active = action.active;
      return true;
    case 'flag':
      p.flag = action.flag;
      p.salePrice = null;
      return true;
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
      .filter((p): p is AdminProduct & { deletedAt: string | null } => !!p && p.active && !p.deletedAt)
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

  constructor(private productsRepo?: FakeProductsRepo) {}

  private baseOrder(order: NewOrder, items: OrderItem[]): Order {
    return {
      id: nextId('o'),
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
      channel: 'online',
      billType: null,
      billNumber: null,
      gstAmount: null,
      deliveryDueDate: null,
      carrier: null,
      awb: null,
      notes: '',
      invoiceSentAt: null,
      advancePaid: 0,
      balance: order.total,
      receipts: [],
      createdAt: new Date(Date.UTC(2026, 5, 1) + ++this.clock * 60_000).toISOString(),
      items,
    };
  }

  async createWithItems(_tx: Tx, order: NewOrder, items: NewOrderItem[]): Promise<Order> {
    // Mirror the order_items FK: once ordered, a product can only be archived.
    for (const it of items) this.productsRepo?.orderedProductIds.add(it.productId);
    const created = this.baseOrder(
      order,
      items.map((it): OrderItem => ({ ...it, measurements: it.measurements ?? '', id: nextId('oi') })),
    );
    this.orders.push(created);
    return structuredClone(created);
  }

  async createOffline(_tx: Tx, order: NewOfflineOrder, items: NewOfflineItem[]): Promise<Order> {
    const created: Order = {
      ...this.baseOrder(
        order,
        items.map(
          (it): OrderItem => ({
            id: nextId('oi'),
            productId: null,
            variantId: null,
            productName: it.productName,
            size: '',
            color: '',
            unitPrice: it.unitPrice,
            quantity: it.quantity,
            imageUrl: null,
            measurements: '',
          }),
        ),
      ),
      channel: order.channel,
      billType: order.billType,
      billNumber: order.billNumber,
      gstAmount: order.gstAmount,
      deliveryDueDate: order.deliveryDueDate,
      notes: order.notes,
    };
    this.orders.push(created);
    return structuredClone(created);
  }

  /** Wired from FakeReceiptsRepo so advancePaid/balance stay consistent. */
  attachReceipt(receipt: Receipt): void {
    const o = this.orders.find((x) => x.id === receipt.orderId);
    if (!o) throw new Error(`unknown order ${receipt.orderId}`); // mimics the FK
    o.receipts.push({ ...receipt });
    o.advancePaid = o.receipts.reduce((sum, r) => sum + r.amount, 0);
    o.balance = o.total - o.advancePaid;
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

  async listDeliveries(): Promise<Order[]> {
    return this.orders
      .filter((o) => o.deliveryDueDate && o.status !== 'delivered' && o.status !== 'cancelled')
      .sort(
        (a, b) =>
          a.deliveryDueDate!.localeCompare(b.deliveryDueDate!) || a.createdAt.localeCompare(b.createdAt),
      )
      .map((o) => structuredClone(o));
  }

  async listAdmin(filter: AdminOrdersFilter = {}): Promise<Order[]> {
    return this.orders
      .filter(
        (o) =>
          (!filter.status || o.status === filter.status) &&
          (!filter.channel || o.channel === filter.channel) &&
          (!filter.billType || o.billType === filter.billType),
      )
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((o) => structuredClone(o));
  }

  async updateStatus(id: string, status: OrderStatus, _tx?: Tx): Promise<Order | null> {
    const o = this.orders.find((x) => x.id === id);
    if (!o) return null;
    o.status = status;
    return structuredClone(o);
  }

  async updateDetails(id: string, patch: OrderDetailsPatch): Promise<Order | null> {
    const o = this.orders.find((x) => x.id === id);
    if (!o) return null;
    if (patch.deliveryDueDate !== undefined) o.deliveryDueDate = patch.deliveryDueDate;
    if (patch.billNumber !== undefined) o.billNumber = patch.billNumber;
    if (patch.billType !== undefined) o.billType = patch.billType;
    if (patch.gstAmount !== undefined) o.gstAmount = patch.gstAmount;
    if (patch.carrier !== undefined) o.carrier = patch.carrier;
    if (patch.awb !== undefined) o.awb = patch.awb;
    if (patch.notes !== undefined) o.notes = patch.notes;
    return structuredClone(o);
  }

  async markInvoiceSent(id: string): Promise<Order | null> {
    const o = this.orders.find((x) => x.id === id);
    if (!o) return null;
    o.invoiceSentAt = new Date(Date.UTC(2026, 5, 3) + ++this.clock * 60_000).toISOString();
    return structuredClone(o);
  }

  async nextOrderNumber(_tx: Tx): Promise<string> {
    return `TA-2026-${String(this.seq++).padStart(5, '0')}`;
  }
}

export class FakeReceiptsRepo implements ReceiptsRepo {
  receipts: Receipt[] = [];
  private clock = 0;

  constructor(private ordersRepo: FakeOrdersRepo) {}

  async create(input: CreateReceiptInput, _tx?: Tx): Promise<Receipt> {
    const receipt: Receipt = {
      id: nextId('rcpt'),
      orderId: input.orderId,
      amount: input.amount,
      mode: input.mode,
      receivedAt: input.receivedAt ?? '2026-07-24',
      note: input.note ?? '',
      createdAt: new Date(Date.UTC(2026, 5, 2) + ++this.clock * 60_000).toISOString(),
    };
    this.ordersRepo.attachReceipt(receipt);
    this.receipts.push(receipt);
    return { ...receipt };
  }

  async listByOrder(orderId: string): Promise<Receipt[]> {
    return this.receipts.filter((r) => r.orderId === orderId).map((r) => ({ ...r }));
  }

  async sumByOrder(orderId: string): Promise<number> {
    return this.receipts.filter((r) => r.orderId === orderId).reduce((sum, r) => sum + r.amount, 0);
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
 *
 * IMPORTANT: this fake aggregates in plain JS (`Number(...)`, property access,
 * etc.), which never throws the way Postgres does. `props` is client-controlled
 * (see events.repo.ts), and the real SQL has to guard every cast of a props
 * value against a poisoned/mistyped shape, or a bad row throws 22P02 and 500s
 * the summary read. Those guards are structural — a CASE expression's branch
 * order is documented SQL semantics (the ELSE/ineligible branch is guaranteed
 * never to evaluate the cast), not something inferred from a particular query
 * plan — but this fake still cannot reproduce the failure mode a broken guard
 * would cause: it never throws the way an unguarded Postgres cast does, so a
 * regression that weakens/removes one of those CASE guards will NOT be caught
 * by tests running against FakeEventsRepo. Cast-guard changes must be
 * verified against real Postgres (see task-4-report.md / the final-fix-report
 * for the throwaway-container approach).
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

export class FakeDocumentsRepo implements DocumentsRepo {
  docs: DocumentRow[] = [];
  private clock = 0;

  async create(input: CreateDocumentInput): Promise<DocumentRow> {
    const doc: DocumentRow = {
      id: `00000000-0000-4000-8000-${String(++idCounter).padStart(12, '0')}`,
      storageKey: input.storageKey,
      kind: input.kind,
      contentType: input.contentType,
      orderId: null,
      uploadedBy: input.uploadedBy,
      parse: null,
      status: 'uploaded',
      createdAt: new Date(Date.UTC(2026, 6, 1) + ++this.clock * 60_000).toISOString(),
    };
    this.docs.push(doc);
    return structuredClone(doc);
  }

  async getById(id: string): Promise<DocumentRow | null> {
    const doc = this.docs.find((d) => d.id === id);
    return doc ? structuredClone(doc) : null;
  }

  async setParse(id: string, parse: unknown, status: DocumentStatus): Promise<DocumentRow | null> {
    const doc = this.docs.find((d) => d.id === id);
    if (!doc) return null;
    doc.parse = parse;
    doc.status = status;
    return structuredClone(doc);
  }

  async setStatusAndOrder(ids: string[], status: DocumentStatus, orderId: string): Promise<void> {
    for (const doc of this.docs) {
      if (ids.includes(doc.id)) {
        doc.status = status;
        doc.orderId = orderId;
      }
    }
  }

  async listByOrder(orderId: string): Promise<DocumentRow[]> {
    return this.docs
      .filter((d) => d.orderId === orderId)
      .sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      .map((d) => structuredClone(d));
  }
}

export class FakeMeasurementsRepo implements MeasurementsRepo {
  measurements: MeasurementRow[] = [];
  private clock = 0;

  async create(input: CreateMeasurementInput, _tx?: Tx): Promise<MeasurementRow> {
    const row: MeasurementRow = {
      id: nextId('m'),
      userId: input.userId,
      orderId: input.orderId ?? null,
      documentId: input.documentId ?? null,
      label: input.label ?? '',
      data: input.data,
      notes: input.notes ?? '',
      createdAt: new Date(Date.UTC(2026, 6, 2) + ++this.clock * 60_000).toISOString(),
    };
    this.measurements.push(row);
    return structuredClone(row);
  }

  async listByUser(userId: string): Promise<MeasurementRow[]> {
    return this.measurements
      .filter((m) => m.userId === userId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((m) => structuredClone(m));
  }

  async listByOrder(orderId: string): Promise<MeasurementRow[]> {
    return this.measurements
      .filter((m) => m.orderId === orderId)
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((m) => structuredClone(m));
  }
}

/** In-memory ObjectStore — "presigned" URLs point at a fake host nothing calls. */
export class FakeObjectStore implements ObjectStore {
  objects = new Map<string, { bytes: Uint8Array; contentType: string }>();

  async presignPut(key: string, contentType: string) {
    return { url: `https://uploads.test/${encodeURIComponent(key)}`, headers: { 'Content-Type': contentType } };
  }

  async presignGet(key: string): Promise<string> {
    return `https://uploads.test/${encodeURIComponent(key)}?signed=1`;
  }

  /** Permanent URL, mirroring the real stores — no signature on it. */
  publicUrl(key: string): string {
    return `https://uploads.test/${encodeURIComponent(key)}`;
  }

  /** Test helper mirroring LocalObjectStore.put. */
  put(key: string, bytes: Uint8Array, contentType: string): void {
    this.objects.set(key, { bytes, contentType });
  }

  async getObject(key: string) {
    const obj = this.objects.get(key);
    if (!obj) throw new Error(`FakeObjectStore: no object for key ${key}`);
    return obj;
  }
}

export class FakeBillParser implements BillParser {
  calls: { kind: ParseKind; mediaType: string; byteLength: number }[] = [];
  draft: unknown = { hello: 'draft' };
  failWith: Error | null = null;

  async parse(kind: ParseKind, image: { bytes: Uint8Array; mediaType: string }): Promise<unknown> {
    this.calls.push({ kind, mediaType: image.mediaType, byteLength: image.bytes.byteLength });
    if (this.failWith) throw this.failWith;
    return this.draft;
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
  otps: FakeOtpsRepo;
  receipts: FakeReceiptsRepo;
  documents: FakeDocumentsRepo;
  measurements: FakeMeasurementsRepo;
}

export function makeFakes(): Fakes {
  const products = new FakeProductsRepo();
  const wishlist = new FakeWishlistRepo(products);
  const orders = new FakeOrdersRepo(products);
  const users = new FakeUsersRepo(orders);
  const payments = new FakePaymentsRepo(orders);
  const scans = new FakeScansRepo();
  const clicks = new FakeClicksRepo();
  const events = new FakeEventsRepo();
  const otps = new FakeOtpsRepo();
  const receipts = new FakeReceiptsRepo(orders);
  const documents = new FakeDocumentsRepo();
  const measurements = new FakeMeasurementsRepo();
  return { users, products, wishlist, orders, payments, scans, clicks, events, otps, receipts, documents, measurements };
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
    // Saved rows carry the family the route resolved for their colour.
    colorFamily: 'green',
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
    colorFamily: 'green',
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
    colorFamily: 'green',
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
    colorFamily: 'green',
    flag: null,
    active: false,
    variants: [{ size: 'M', stock: 2 }],
  });

  return { lehengas, gowns, sage, moss, plain, inactive };
}

/**
 * A full set added on demand: dupatta and jacket priced separately, included
 * by default. Kept out of seedCatalog so existing count/related assertions
 * stay untouched.
 */
export async function seedSetProduct(products: FakeProductsRepo, categoryId: string) {
  return products.createProduct({
    categoryId,
    slug: 'fern-zardozi-set-fern',
    name: 'Fern Zardozi Set',
    description: 'Zardozi lehenga with dupatta and jacket.',
    details: 'Dry clean only',
    price: 15000000,
    color: 'Fern',
    flag: null,
    collection: 'The Verdant Edit',
    craft: 'Zardozi',
    fabric: 'Tissue',
    occasion: 'Wedding',
    dupattaPrice: 1200000,
    jacketPrice: 2400000,
    variants: [{ size: 'M', stock: 10 }],
  });
}
