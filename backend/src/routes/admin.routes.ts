import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { OrdersRepo } from '../data/orders.repo';
import type { PaymentsRepo } from '../data/payments.repo';
import type { ProductsRepo } from '../data/products.repo';
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
    return c.json({
      activeOrders: orders.filter((o) => ACTIVE_ORDER_STATUSES.includes(o.status)).length,
      revenue: orders.filter((o) => paidOrLater.includes(o.status)).reduce((sum, o) => sum + o.total, 0),
      pendingPayments: orders.filter((o) => o.status === 'pending_payment').length,
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

  r.get('/orders', zValidator('query', z.object({ status: z.enum(ORDER_STATUSES).optional() }), zodHook), async (c) => {
    return c.json(await deps.orders.listAdmin(c.req.valid('query').status));
  });

  r.patch('/orders/:id', zValidator('json', z.object({ status: z.enum(ORDER_STATUSES) }), zodHook), async (c) => {
    return c.json(await deps.ordersService.updateStatus(c.req.param('id'), c.req.valid('json').status));
  });

  r.get('/payments', async (c) => c.json(await deps.payments.listAdmin()));

  return r;
}
