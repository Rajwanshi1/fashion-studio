import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { PaymentsService } from '../services/payments.service';
import { zodHook } from './hooks';

const checkoutSchema = z.object({ orderId: z.string().min(1) });

const confirmSchema = z.object({
  paymentId: z.string().min(1),
  outcome: z.enum(['success', 'failure']),
});

export function paymentRoutes(payments: PaymentsService) {
  const r = new Hono();

  r.post('/checkout', zValidator('json', checkoutSchema, zodHook), async (c) => {
    return c.json(await payments.checkout(c.req.valid('json').orderId));
  });

  // Mock of the Razorpay handler + webhook in one endpoint.
  r.post('/confirm', zValidator('json', confirmSchema, zodHook), async (c) => {
    const { paymentId, outcome } = c.req.valid('json');
    return c.json(await payments.confirm(paymentId, outcome));
  });

  return r;
}
