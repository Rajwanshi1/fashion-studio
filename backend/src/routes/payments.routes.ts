import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { AuthEnv, optionalAuth } from '../middleware/auth';
import type { PaymentsService } from '../services/payments.service';
import { zodHook } from './hooks';

// Guests prove ownership with the order email; signed-in users via their JWT.
const checkoutSchema = z.object({
  orderId: z.string().min(1),
  email: z.string().email().optional(),
});

const confirmSchema = z.object({
  paymentId: z.string().min(1),
  outcome: z.enum(['success', 'failure']),
  email: z.string().email().optional(),
});

export function paymentRoutes(payments: PaymentsService, jwtSecret: string) {
  const r = new Hono<AuthEnv>();

  r.post('/checkout', optionalAuth(jwtSecret), zValidator('json', checkoutSchema, zodHook), async (c) => {
    const { orderId, email } = c.req.valid('json');
    return c.json(await payments.checkout(orderId, { userId: c.var.user?.id ?? null, email: email ?? null }));
  });

  // Mock of the Razorpay handler + webhook in one endpoint.
  r.post('/confirm', optionalAuth(jwtSecret), zValidator('json', confirmSchema, zodHook), async (c) => {
    const { paymentId, outcome, email } = c.req.valid('json');
    return c.json(
      await payments.confirm(paymentId, outcome, { userId: c.var.user?.id ?? null, email: email ?? null }),
    );
  });

  return r;
}
