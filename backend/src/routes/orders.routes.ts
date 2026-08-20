import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { AuthEnv, optionalAuth, requireAuth } from '../middleware/auth';
import type { OrdersService } from '../services/orders.service';
import { zodHook } from './hooks';

const createOrderSchema = z.object({
  customer: z.object({
    email: z.string().email(),
    phone: z.string().optional(),
    firstName: z.string().min(1),
    lastName: z.string().optional(),
    addressLine1: z.string().min(1),
    addressLine2: z.string().optional(),
    city: z.string().min(1),
    state: z.string().min(1),
    pincode: z.string().min(1),
    country: z.string().optional(),
  }),
  deliveryMethod: z.enum(['standard', 'priority']).default('standard'),
  // Emptiness is a domain rule (EMPTY_ORDER), enforced by the service.
  items: z.array(
    z.object({
      variantId: z.string().min(1),
      quantity: z.number().int().min(1),
      // Optional set pieces the shopper unticked; everything else is included.
      excludedComponents: z.array(z.string().trim().min(1).max(40)).max(10).optional(),
      // Paise the cart displayed per unit; the service 409s on disagreement.
      expectedUnitPrice: z.number().int().min(0).optional(),
      // Custom colour on request (+₹1,000, priced by the service).
      customColor: z.boolean().optional(),
      // Deprecated pre-components booleans, still accepted for one release so a
      // cached old SPA is priced by what it actually displayed (zod would strip
      // them and the order would include pieces the shopper unticked). Remove
      // with the legacy-column drop chore.
      includeDupatta: z.boolean().optional(),
      includeJacket: z.boolean().optional(),
      // 500 keeps a 10-line order well under the prod WAF's 8KB body cap.
      measurements: z.string().max(500).optional(),
    }),
  ),
});

type OrderItemBody = z.infer<typeof createOrderSchema>['items'][number];
type ServiceItem = Omit<OrderItemBody, 'includeDupatta' | 'includeJacket'> & {
  legacyIncludes?: { dupatta: boolean; jacket: boolean };
};

/**
 * Requests carrying the include booleans come from the pre-components
 * storefront. Marking them (rather than mapping to exclusions) lets the
 * service restrict pricing to the two pieces that UI ever displayed — any
 * newly named optional component was invisible to that shopper.
 */
function withLegacyIncludes(item: OrderItemBody): ServiceItem {
  const { includeDupatta, includeJacket, ...rest } = item;
  if (includeDupatta === undefined && includeJacket === undefined) return rest;
  // Missing boolean = included, the old UI's default.
  return { ...rest, legacyIncludes: { dupatta: includeDupatta !== false, jacket: includeJacket !== false } };
}

export function orderRoutes(orders: OrdersService, jwtSecret: string) {
  const r = new Hono<AuthEnv>();

  r.post('/orders', optionalAuth(jwtSecret), zValidator('json', createOrderSchema, zodHook), async (c) => {
    const body = c.req.valid('json');
    const order = await orders.createOrder({
      ...body,
      items: body.items.map(withLegacyIncludes),
      userId: c.var.user?.id ?? null,
    });
    return c.json(order, 201);
  });

  // First-order-discount eligibility for the signed-in shopper (Bearer, like /me/orders).
  r.get('/orders/me/first-order-offer', requireAuth(jwtSecret), async (c) => {
    return c.json(await orders.firstOrderOffer(c.var.user!.id));
  });

  // Guest tracking: requires a matching Bearer user or ?email= matching the order.
  r.get('/orders/:orderNumber', optionalAuth(jwtSecret), async (c) => {
    const order = await orders.getOrderForRequester(c.req.param('orderNumber'), {
      userId: c.var.user?.id ?? null,
      email: c.req.query('email') ?? null,
    });
    return c.json(order);
  });

  r.get('/me/orders', requireAuth(jwtSecret), async (c) => {
    return c.json(await orders.listUserOrders(c.var.user!.id));
  });

  return r;
}
