import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { DocumentsRepo } from '../data/documents.repo';
import type { MeasurementsRepo } from '../data/measurements.repo';
import type { OrdersRepo } from '../data/orders.repo';
import type { PaymentsRepo } from '../data/payments.repo';
import type { ProductsRepo, UpdateProductInput } from '../data/products.repo';
import type { UsersRepo } from '../data/users.repo';
import { deliveryTotals } from '../lib/deliveries';
import { normalizePhone } from '../lib/phone';
import { customersToVcf } from '../lib/vcard';
import { AuthEnv, requireAdmin, requireAuth } from '../middleware/auth';
import { resolveColorFamily, type CatalogAi } from '../services/ai/catalog-ai';
import type { DocumentsService } from '../services/documents.service';
import type { InvoicesService } from '../services/invoices.service';
import { namedStorageKey, newStorageKey, sanitizeFileSlug, type ObjectStore } from '../services/objectstore';
import type { OrdersService } from '../services/orders.service';
import { DomainError, OrderStatus } from '../types';
import { zodHook } from './hooks';

const ORDER_STATUSES = [
  'pending_payment',
  'paid',
  'in_atelier',
  'quality_check',
  'dispatched',
  'delivered',
  'cancelled',
] as const;

const ORDER_CHANNELS = ['online', 'in_store', 'instagram', 'exhibition'] as const;
const OFFLINE_CHANNELS = ['in_store', 'instagram', 'exhibition'] as const;
const BILL_TYPES = ['gst_invoice', 'cash_memo'] as const;
const RECEIPT_MODES = ['cash', 'online'] as const;
const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

const offlineCustomerSchema = z.discriminatedUnion('action', [
  z.object({ action: z.literal('link'), userId: z.string().min(1) }),
  z.object({
    action: z.literal('create'),
    firstName: z.string().min(1),
    lastName: z.string().optional(),
    phone: z.string().min(1),
    email: z.string().email().optional(),
    addressLine1: z.string().optional(),
    addressLine2: z.string().optional(),
    city: z.string().optional(),
    state: z.string().optional(),
    pincode: z.string().optional(),
  }),
]);

const measurementSetSchema = z.object({
  label: z.string().optional(),
  /** Names/values verbatim from the measurement page. */
  data: z.record(z.string()),
  notes: z.string().optional(),
  documentId: z.string().nullable().optional(),
});

const createOfflineOrderSchema = z.object({
  channel: z.enum(OFFLINE_CHANNELS),
  billType: z.enum(BILL_TYPES),
  billNumber: z.string().optional(),
  customer: offlineCustomerSchema,
  items: z
    .array(
      z
        .object({
          description: z.string().min(1),
          quantity: z.number().int().min(1),
          unitPrice: z.number().int().min(0),
          productId: z.string().min(1).optional(),
          variantId: z.string().min(1).optional(),
        })
        // Both or neither: a variant link without its product (or vice versa)
        // cannot be validated against the catalogue.
        .refine((it) => (it.productId === undefined) === (it.variantId === undefined), {
          message: 'productId and variantId must be sent together',
        }),
    )
    .min(1)
    // Keeps the JSON body comfortably under the WAF's edge cap on request size.
    .max(100),
  gstAmount: z.number().int().min(0).optional(),
  total: z.number().int().min(0),
  advance: z.object({ amount: z.number().int().positive(), mode: z.enum(RECEIPT_MODES) }).optional(),
  deliveryDueDate: z.string().regex(DATE_RE).optional(),
  notes: z.string().optional(),
  initialStatus: z.enum(['in_atelier', 'quality_check', 'dispatched', 'delivered']).optional(),
  documentIds: z.array(z.string().min(1)).optional(),
  measurementSets: z.array(measurementSetSchema).optional(),
}).superRefine((v, ctx) => {
  // A GST invoice without a number is a compliance problem, not a draft.
  if (v.billType === 'gst_invoice' && !v.billNumber?.trim()) {
    ctx.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['billNumber'],
      message: 'A GST invoice needs a bill number',
    });
  }
});

const receiptSchema = z.object({
  amount: z.number().int().positive(),
  mode: z.enum(RECEIPT_MODES),
  receivedAt: z.string().regex(DATE_RE).optional(),
  note: z.string().optional(),
});

// One PATCH endpoint: a body with `status` walks the machine, anything else
// patches the bill/delivery details.
const patchOrderSchema = z.object({
  status: z.enum(ORDER_STATUSES).optional(),
  deliveryDueDate: z.string().regex(DATE_RE).nullable().optional(),
  billNumber: z.string().nullable().optional(),
  billType: z.enum(BILL_TYPES).nullable().optional(),
  gstAmount: z.number().int().min(0).nullable().optional(),
  carrier: z.string().nullable().optional(),
  awb: z.string().nullable().optional(),
  notes: z.string().optional(),
});

const DOCUMENT_KINDS = ['bill', 'measurement', 'shipping_receipt'] as const;
const UPLOAD_CONTENT_TYPES = ['image/jpeg', 'image/png', 'image/webp'] as const;

const presignSchema = z.object({
  kind: z.enum(DOCUMENT_KINDS),
  contentType: z.enum(UPLOAD_CONTENT_TYPES),
});

/** Base64 of a ~10MB JPEG — the naming call is refused above this. */
const MAX_IMAGE_BASE64 = 14_000_000;
const MAX_SLUG_ATTEMPTS = 6;

const productImagePresignSchema = z
  .object({
    contentType: z.literal('image/jpeg'),
    // Both or neither: naming needs the piece's name AND the pixels.
    productName: z.string().min(1).optional(),
    imageBase64: z.string().max(MAX_IMAGE_BASE64).optional(),
  })
  .refine((v) => (v.productName === undefined) === (v.imageBase64 === undefined), {
    message: 'productName and imageBase64 must be sent together',
  });

const flagSchema = z.enum(['bestseller', 'new', 'sale']).nullable();

const productBaseSchema = z.object({
  // The category can be referenced by id or by slug (the admin UI knows slugs).
  categoryId: z.string().min(1).optional(),
  categorySlug: z.string().min(1).optional(),
  // Optional: omitted → derived from name + colour (see the create route).
  slug: z.string().min(1).optional(),
  name: z.string().min(1),
  // Bounded in BYTES so a product write can never outgrow the WAF's edge cap
  // on request size (32KB): the cap counts UTF-8 bytes, and Devanagari prose
  // runs ~3 bytes per char, so a char-count limit would not actually bound
  // the body. 10KB of prose is far beyond any real listing.
  description: z
    .string()
    .refine((s) => Buffer.byteLength(s, 'utf8') <= 10_000, {
      message: 'Description is too long — keep it under 10KB of text',
    })
    .optional(),
  details: z
    .string()
    .refine((s) => Buffer.byteLength(s, 'utf8') <= 10_000, {
      message: 'Details are too long — keep them under 10KB of text',
    })
    .optional(),
  price: z.number().int().min(0),
  color: z.string().optional(),
  flag: flagSchema.optional(),
  imageUrl: z.string().nullable().optional(),
  active: z.boolean().optional(),
  collection: z.string().optional(),
  craft: z.string().optional(),
  fabric: z.string().optional(),
  occasion: z.string().optional(),
  // null = no such piece in the set; 0 = included at no extra cost.
  dupattaPrice: z.number().int().min(0).nullable().optional(),
  jacketPrice: z.number().int().min(0).nullable().optional(),
  // Discounted BASE price — add-ons are never discounted.
  salePrice: z.number().int().positive().nullable().optional(),
  costPrice: z.number().int().min(0).nullable().optional(),
  images: z.array(z.object({ url: z.string().min(1), pose: z.string().optional() })).max(12).optional(),
  variants: z.array(z.object({ size: z.string().min(1), stock: z.number().int().min(0) })).optional(),
});

// Unknown/malformed ids surface as per-id `not_found` outcomes, not a 400.
const bulkDeleteSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
});

// One merchandising edit applied to a whole selection. 'sale' takes a
// percentage, not a price: every piece is discounted off its own list price.
const bulkUpdateSchema = z.object({
  ids: z.array(z.string().min(1)).min(1).max(200),
  action: z.discriminatedUnion('type', [
    z.object({ type: z.literal('sale'), discountPct: z.number().int().min(1).max(95) }),
    z.object({ type: z.literal('end_sale') }),
    z.object({ type: z.literal('visibility'), active: z.boolean() }),
    z.object({ type: z.literal('flag'), flag: z.enum(['new', 'bestseller']).nullable() }),
  ]),
});

const createProductSchema = productBaseSchema
  .superRefine((v, ctx) => {
    if (v.flag === 'sale') {
      if (v.salePrice == null) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['salePrice'], message: 'a sale piece needs a salePrice' });
      } else if (v.salePrice >= v.price) {
        ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['salePrice'], message: 'salePrice must be below price' });
      }
    } else if (v.salePrice != null) {
      ctx.addIssue({ code: z.ZodIssueCode.custom, path: ['salePrice'], message: 'salePrice needs flag "sale"' });
    }
  })
  .refine((v) => v.categoryId || v.categorySlug, {
    message: 'categoryId or categorySlug is required',
  });

// No `slug`: a PUT can never rename a piece (zod strips it, so old clients that
// still send one get a 200 with the slug untouched rather than a 400).
const updateProductSchema = productBaseSchema.omit({ variants: true, slug: true }).partial();

/** Lowercase kebab-case; the same shape the seed data and pre-existing catalog slugs use. */
function slugify(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
}

export interface AdminDeps {
  products: ProductsRepo;
  orders: OrdersRepo;
  payments: PaymentsRepo;
  users: UsersRepo;
  documents: DocumentsRepo;
  measurements: MeasurementsRepo;
  ordersService: OrdersService;
  documentsService: DocumentsService;
  invoicesService: InvoicesService;
  /** Null → product-image presign answers 503. */
  objectStore: ObjectStore | null;
  /** Null → colours fall back to the keyword map and photos to uuid names. */
  catalogAi: CatalogAi | null;
  jwtSecret: string;
}

const ACTIVE_ORDER_STATUSES: OrderStatus[] = ['paid', 'in_atelier', 'quality_check', 'dispatched'];

export function adminRoutes(deps: AdminDeps) {
  const r = new Hono<AuthEnv>();
  r.use('*', requireAuth(deps.jwtSecret), requireAdmin);

  /** Resolve categorySlug → categoryId; returns undefined when the slug is unknown. */
  async function resolveCategoryId(body: { categoryId?: string; categorySlug?: string }): Promise<string | undefined> {
    if (body.categoryId) return body.categoryId;
    if (!body.categorySlug) return undefined;
    const categories = await deps.products.listCategories();
    return categories.find((cat) => cat.slug === body.categorySlug)?.id;
  }

  r.get('/summary', async (c) => {
    const [products, orders] = await Promise.all([deps.products.listAllProducts(), deps.orders.listAdmin()]);
    const paidOrLater: OrderStatus[] = ['paid', 'in_atelier', 'quality_check', 'dispatched', 'delivered'];
    const lowStock = products
      .filter((p) => p.active)
      .flatMap((p) =>
        p.variants
          .filter((v) => v.size !== 'Custom' && v.stock <= 2)
          .map((v) => ({ productId: p.id, variantId: v.id, productName: p.name, size: v.size, stock: v.stock })),
      );
    // listAdmin returns newest first.
    const recentOrders = orders.slice(0, 8).map((o) => ({
      id: o.id,
      orderNumber: o.orderNumber,
      createdAt: o.createdAt,
      firstName: o.firstName,
      lastName: o.lastName,
      total: o.total,
      status: o.status,
      itemsCount: o.items.reduce((sum, it) => sum + it.quantity, 0),
    }));
    const revenueOrders = orders.filter((o) => paidOrLater.includes(o.status));
    const revenueByChannel: Partial<Record<(typeof ORDER_CHANNELS)[number], number>> = {};
    const revenueByBillType: Partial<Record<(typeof BILL_TYPES)[number], number>> = {};
    for (const o of revenueOrders) {
      revenueByChannel[o.channel] = (revenueByChannel[o.channel] ?? 0) + o.total;
      if (o.billType) revenueByBillType[o.billType] = (revenueByBillType[o.billType] ?? 0) + o.total;
    }
    // Money actually in hand, not billed value: every receipt ever taken
    // (cancelled orders included — their cash was never refunded), plus online
    // orders once the gateway captured them (gateway money never writes
    // receipts).
    const revenue =
      orders.reduce((sum, o) => sum + o.advancePaid, 0) +
      orders
        .filter((o) => o.channel === 'online' && paidOrLater.includes(o.status))
        .reduce((sum, o) => sum + o.total, 0);
    // One population for both halves of the "To Collect" card — the count must
    // caption the same orders the rupee figure sums. Online pending_payment
    // orders are excluded: nothing is collectible at the counter for them, and
    // abandoned checkouts would inflate the count forever.
    const owing = orders.filter(
      (o) => o.channel !== 'online' && o.status !== 'cancelled' && o.balance > 0,
    );
    const pendingToCollect = owing.reduce((sum, o) => sum + o.balance, 0);
    return c.json({
      activeOrders: orders.filter((o) => ACTIVE_ORDER_STATUSES.includes(o.status)).length,
      revenue,
      pendingPayments: owing.length,
      revenueByChannel,
      revenueByBillType,
      pendingToCollect,
      lowStock,
      recentOrders,
    });
  });

  // The delivery board: open orders with a promised date, soonest first.
  r.get('/deliveries', async (c) => {
    const orders = await deps.orders.listDeliveries();
    return c.json({ orders, totals: deliveryTotals(orders) });
  });

  // iPhone contacts export — Safari hands the download to the Contacts app.
  r.get('/customers.vcf', async (c) => {
    const body = customersToVcf(await deps.users.listWithPhone());
    c.header('Content-Type', 'text/vcard; charset=utf-8');
    c.header('Content-Disposition', 'attachment; filename="ta-customers.vcf"');
    return c.body(body);
  });

  r.get('/products', async (c) => c.json(await deps.products.listAllProducts()));

  r.post('/products', zValidator('json', createProductSchema, zodHook), async (c) => {
    const { categorySlug, ...body } = c.req.valid('json');
    const categoryId = await resolveCategoryId({ categoryId: body.categoryId, categorySlug });
    if (!categoryId) return c.json({ error: 'Category not found' }, 404);
    const colorFamily = body.color === undefined ? undefined : await resolveColorFamily(deps.catalogAi, body.color);
    // The admin form no longer asks for a slug: derive it from name + colour and
    // uniquify with a bounded suffix. An explicitly sent slug is taken as-is —
    // a collision there is still the admin's 409 to resolve.
    const base = body.slug?.trim() || slugify(`${body.name} ${body.color ?? ''}`);
    for (let attempt = 1; ; attempt++) {
      const slug = attempt === 1 ? base : `${base}-${attempt}`;
      try {
        return c.json(await deps.products.createProduct({ ...body, categoryId, slug, colorFamily }), 201);
      } catch (err) {
        const canRetry =
          attempt < MAX_SLUG_ATTEMPTS &&
          !body.slug &&
          err instanceof DomainError &&
          err.code === 'SLUG_TAKEN';
        if (!canRetry) throw err;
      }
    }
  });

  // Presign a direct-to-storage PUT for a product photo and hand back the
  // permanent public URL to store in the gallery. The admin client always
  // re-encodes to JPEG (see admin/src/lib/image.ts).
  //
  // With productName + imageBase64 (and an AI configured) the photo is named
  // first, so the object key is the SEO name shoppers see in the URL. Naming is
  // best-effort: anything unusable falls back to the uuid key, pose null.
  r.post('/uploads/product-image', zValidator('json', productImagePresignSchema, zodHook), async (c) => {
    if (!deps.objectStore) return c.json({ error: 'Uploads are not configured' }, 503);
    const { contentType, productName, imageBase64 } = c.req.valid('json');
    let key: string | null = null;
    let pose: string | null = null;
    if (productName && imageBase64 && deps.catalogAi) {
      try {
        const bytes = Buffer.from(imageBase64, 'base64');
        const named = await deps.catalogAi.nameProductImage({ bytes, mediaType: contentType }, productName);
        const fileSlug = named ? sanitizeFileSlug(named.fileSlug) : '';
        if (fileSlug) {
          key = namedStorageKey('products', fileSlug);
          pose = named!.pose ?? null;
        }
      } catch {
        // Naming never blocks an upload — fall through to the uuid key.
      }
    }
    if (!key) key = newStorageKey('products');
    const { url, headers } = await deps.objectStore.presignPut(key, contentType);
    return c.json({ key, uploadUrl: url, headers, publicUrl: deps.objectStore.publicUrl(key), pose }, 201);
  });

  r.post('/products/bulk-delete', zValidator('json', bulkDeleteSchema, zodHook), async (c) => {
    const { ids } = c.req.valid('json');
    const { deleted, archived } = await deps.products.bulkDelete(ids);
    const resolved = new Set([...deleted, ...archived]);
    const results = [
      ...deleted.map((id) => ({ id, outcome: 'deleted' as const })),
      ...archived.map((id) => ({ id, outcome: 'archived' as const })),
      ...ids.filter((id) => !resolved.has(id)).map((id) => ({ id, outcome: 'not_found' as const })),
    ];
    return c.json({ results });
  });

  // Same per-id result shape as bulk-delete, so the admin handles both alike.
  // 'skipped' means the piece exists but the action didn't apply — in practice
  // a discount that wouldn't leave a valid sale price, or an end-sale on a
  // piece that was never on sale.
  r.post('/products/bulk-update', zValidator('json', bulkUpdateSchema, zodHook), async (c) => {
    const { ids, action } = c.req.valid('json');
    const { updated, skipped, notFound } = await deps.products.bulkUpdate(ids, action);
    const results = [
      ...updated.map((id) => ({ id, outcome: 'updated' as const })),
      ...skipped.map((id) => ({ id, outcome: 'skipped' as const })),
      ...notFound.map((id) => ({ id, outcome: 'not_found' as const })),
    ];
    return c.json({ results });
  });

  r.put('/products/:id', zValidator('json', updateProductSchema, zodHook), async (c) => {
    const { categorySlug, ...body } = c.req.valid('json');
    const patch: UpdateProductInput = { ...body };
    if (categorySlug) {
      const categoryId = await resolveCategoryId({ categoryId: body.categoryId, categorySlug });
      if (!categoryId) return c.json({ error: 'Category not found' }, 404);
      patch.categoryId = categoryId;
    }
    // Leaving the sale clears the discount, so a stale sale_price can never be
    // charged; staying on sale re-validates whenever both numbers are in play.
    if (body.flag !== undefined && body.flag !== 'sale') patch.salePrice = null;
    if (body.flag === 'sale' && body.salePrice != null && body.price !== undefined) {
      if (body.salePrice <= 0 || body.salePrice >= body.price) {
        return c.json({ error: 'salePrice: must be above 0 and below price' }, 400);
      }
    }
    if (body.color !== undefined) patch.colorFamily = await resolveColorFamily(deps.catalogAi, body.color);
    const product = await deps.products.updateProduct(c.req.param('id'), patch);
    if (!product) return c.json({ error: 'Product not found' }, 404);
    return c.json(product);
  });

  r.patch('/variants/:id', zValidator('json', z.object({ stock: z.number().int().min(0) }), zodHook), async (c) => {
    const variant = await deps.products.setVariantStock(c.req.param('id'), c.req.valid('json').stock);
    if (!variant) return c.json({ error: 'Variant not found' }, 404);
    return c.json(variant);
  });

  r.get(
    '/orders',
    zValidator(
      'query',
      z.object({
        status: z.enum(ORDER_STATUSES).optional(),
        channel: z.enum(ORDER_CHANNELS).optional(),
        billType: z.enum(BILL_TYPES).optional(),
      }),
      zodHook,
    ),
    async (c) => {
      return c.json(await deps.orders.listAdmin(c.req.valid('query')));
    },
  );

  r.post('/orders', zValidator('json', createOfflineOrderSchema, zodHook), async (c) => {
    return c.json(await deps.ordersService.createOfflineOrder(c.req.valid('json')), 201);
  });

  r.post('/orders/:id/receipts', zValidator('json', receiptSchema, zodHook), async (c) => {
    return c.json(await deps.ordersService.recordReceipt(c.req.param('id'), c.req.valid('json')));
  });

  r.patch('/orders/:id', zValidator('json', patchOrderSchema, zodHook), async (c) => {
    const { status, ...details } = c.req.valid('json');
    if (status) return c.json(await deps.ordersService.updateStatus(c.req.param('id'), status));
    return c.json(await deps.ordersService.updateOrderDetails(c.req.param('id'), details));
  });

  // Regenerated per request so balance/receipts are always current — nothing persisted.
  r.get('/orders/:id/invoice.pdf', async (c) => {
    const { pdf, filename } = await deps.invoicesService.invoicePdf(c.req.param('id'));
    c.header('Content-Type', 'application/pdf');
    c.header('Content-Disposition', `inline; filename="${filename}"`);
    return c.body(new Uint8Array(pdf));
  });

  // No request body by design: the PDF is rendered server-side and uploaded to
  // WhatsApp, never round-tripped through the client (prod WAF caps bodies at 8KB).
  r.post('/orders/:id/invoice/send', async (c) => {
    return c.json(await deps.invoicesService.sendInvoice(c.req.param('id')));
  });

  // ---- Document scanning (bill/measurement/receipt photos → Claude drafts) ----

  const toDocumentSummary = (d: { id: string; kind: string; status: string; createdAt: string }) => ({
    id: d.id,
    kind: d.kind,
    status: d.status,
    createdAt: d.createdAt,
  });

  r.post('/uploads/presign', zValidator('json', presignSchema, zodHook), async (c) => {
    const { kind, contentType } = c.req.valid('json');
    return c.json(await deps.documentsService.startUpload(kind, contentType, c.var.user!.id), 201);
  });

  // 503 (NOT_CONFIGURED) while ANTHROPIC_API_KEY is absent — the SPA falls back
  // to manual entry with the photos still attached.
  r.post('/documents/:id/parse', async (c) => {
    const draft = await deps.documentsService.parseDocument(c.req.param('id'));
    return c.json(draft as Record<string, unknown>);
  });

  r.get('/documents/:id/url', async (c) => {
    return c.json({ url: await deps.documentsService.viewUrl(c.req.param('id')) });
  });

  r.get('/orders/:id/documents', async (c) => {
    const docs = await deps.documentsService.listByOrder(c.req.param('id'));
    return c.json(docs.map(toDocumentSummary));
  });

  // Attach a late document (shipping receipt) to an existing order — confirmed
  // immediately, unlike intake documents which confirm with the order create.
  r.post(
    '/orders/:id/documents',
    zValidator('json', z.object({ documentId: z.string().min(1) }), zodHook),
    async (c) => {
      const orderId = c.req.param('id');
      const { documentId } = c.req.valid('json');
      const order = await deps.orders.getById(orderId);
      if (!order) return c.json({ error: 'Order not found' }, 404);
      const doc = await deps.documents.getById(documentId);
      if (!doc) return c.json({ error: 'Document not found' }, 404);
      await deps.documentsService.attachToOrder([documentId], orderId);
      return c.json(toDocumentSummary({ ...doc, status: 'confirmed' }), 201);
    },
  );

  r.get(
    '/measurements',
    zValidator('query', z.object({ userId: z.string().optional(), orderId: z.string().optional() }), zodHook),
    async (c) => {
      const { userId, orderId } = c.req.valid('query');
      if (userId) return c.json(await deps.measurements.listByUser(userId));
      if (orderId) return c.json(await deps.measurements.listByOrder(orderId));
      return c.json({ error: 'userId or orderId is required' }, 400);
    },
  );

  r.get(
    '/customers/match',
    zValidator('query', z.object({ phone: z.string().optional(), q: z.string().optional() }), zodHook),
    async (c) => {
      const { phone, q } = c.req.valid('query');
      const normalized = phone ? normalizePhone(phone) : null;
      const query = q?.trim() || undefined;
      const candidates = normalized || query ? await deps.users.searchAdmin(normalized, query) : [];
      return c.json({ candidates });
    },
  );

  r.get('/payments', async (c) => c.json(await deps.payments.listLedger()));

  r.get('/users', async (c) => c.json(await deps.users.listAdmin()));

  r.patch('/users/:id', zValidator('json', z.object({ role: z.enum(['customer', 'admin']) }), zodHook), async (c) => {
    const id = c.req.param('id');
    if (id === c.var.user!.id) return c.json({ error: 'You cannot change your own role' }, 400);
    const user = await deps.users.updateRole(id, c.req.valid('json').role);
    if (!user) return c.json({ error: 'User not found' }, 404);
    return c.json(user);
  });

  return r;
}
