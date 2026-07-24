import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { OrdersRepo } from '../data/orders.repo';
import type { PaymentsRepo } from '../data/payments.repo';
import type { ProductsRepo } from '../data/products.repo';
import type { UsersRepo } from '../data/users.repo';
import { normalizePhone } from '../lib/phone';
import { AuthEnv, requireAdmin, requireAuth } from '../middleware/auth';
import type { OrdersService } from '../services/orders.service';
import { OrderStatus } from '../types';
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

const createOfflineOrderSchema = z.object({
  channel: z.enum(OFFLINE_CHANNELS),
  billType: z.enum(BILL_TYPES),
  billNumber: z.string().optional(),
  customer: offlineCustomerSchema,
  items: z
    .array(
      z.object({
        description: z.string().min(1),
        quantity: z.number().int().min(1),
        unitPrice: z.number().int().min(0),
      }),
    )
    .min(1),
  gstAmount: z.number().int().min(0).optional(),
  total: z.number().int().min(0),
  advance: z.object({ amount: z.number().int().positive(), mode: z.enum(RECEIPT_MODES) }).optional(),
  deliveryDueDate: z.string().regex(DATE_RE).optional(),
  notes: z.string().optional(),
  initialStatus: z.enum(['in_atelier', 'delivered']).optional(),
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
  notes: z.string().optional(),
});

const flagSchema = z.enum(['bestseller', 'new']).nullable();

const productBaseSchema = z.object({
  // The category can be referenced by id or by slug (the admin UI knows slugs).
  categoryId: z.string().min(1).optional(),
  categorySlug: z.string().min(1).optional(),
  slug: z.string().min(1),
  name: z.string().min(1),
  description: z.string().optional(),
  details: z.string().optional(),
  price: z.number().int().min(0),
  color: z.string().optional(),
  flag: flagSchema.optional(),
  imageUrl: z.string().nullable().optional(),
  active: z.boolean().optional(),
  variants: z.array(z.object({ size: z.string().min(1), stock: z.number().int().min(0) })).optional(),
});

const createProductSchema = productBaseSchema.refine((v) => v.categoryId || v.categorySlug, {
  message: 'categoryId or categorySlug is required',
});

const updateProductSchema = productBaseSchema.omit({ variants: true }).partial();

export interface AdminDeps {
  products: ProductsRepo;
  orders: OrdersRepo;
  payments: PaymentsRepo;
  users: UsersRepo;
  ordersService: OrdersService;
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
          .map((v) => ({ productId: p.id, productName: p.name, size: v.size, stock: v.stock })),
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
    const pendingToCollect = orders
      .filter((o) => o.channel !== 'online' && o.status !== 'cancelled' && o.status !== 'delivered')
      .reduce((sum, o) => sum + (o.total - o.advancePaid), 0);
    return c.json({
      activeOrders: orders.filter((o) => ACTIVE_ORDER_STATUSES.includes(o.status)).length,
      revenue: revenueOrders.reduce((sum, o) => sum + o.total, 0),
      pendingPayments: orders.filter((o) => o.status === 'pending_payment').length,
      revenueByChannel,
      revenueByBillType,
      pendingToCollect,
      lowStock,
      recentOrders,
    });
  });

  r.get('/products', async (c) => c.json(await deps.products.listAllProducts()));

  r.post('/products', zValidator('json', createProductSchema, zodHook), async (c) => {
    const { categorySlug, ...body } = c.req.valid('json');
    const categoryId = await resolveCategoryId({ categoryId: body.categoryId, categorySlug });
    if (!categoryId) return c.json({ error: 'Category not found' }, 404);
    return c.json(await deps.products.createProduct({ ...body, categoryId }), 201);
  });

  r.put('/products/:id', zValidator('json', updateProductSchema, zodHook), async (c) => {
    const { categorySlug, ...body } = c.req.valid('json');
    if (categorySlug) {
      const categoryId = await resolveCategoryId({ categoryId: body.categoryId, categorySlug });
      if (!categoryId) return c.json({ error: 'Category not found' }, 404);
      body.categoryId = categoryId;
    }
    const product = await deps.products.updateProduct(c.req.param('id'), body);
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

  r.get('/payments', async (c) => c.json(await deps.payments.listAdmin()));

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
