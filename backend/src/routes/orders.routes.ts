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
      includeDupatta: z.boolean().optional(),
      includeJacket: z.boolean().optional(),
      // 500 keeps a 10-line order well under the prod WAF's 8KB body cap.
      measurements: z.string().max(500).optional(),
    }),
  ),
});

export function orderRoutes(orders: OrdersService, jwtSecret: string) {
  const r = new Hono<AuthEnv>();

  r.post('/orders', optionalAuth(jwtSecret), zValidator('json', createOrderSchema, zodHook), async (c) => {
    const body = c.req.valid('json');
    const order = await orders.createOrder({ ...body, userId: c.var.user?.id ?? null });
    return c.json(order, 201);
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
