import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { AuthEnv, requireAdmin, requireAuth } from '../middleware/auth';
import type { AnalyticsService } from '../services/analytics.service';
import { zodHook } from './hooks';

export const EVENT_TYPES = [
  'session_start', 'page_view', 'product_view', 'add_to_cart', 'remove_from_cart',
  'checkout_start', 'checkout_step', 'payment_result', 'order_placed',
  'search', 'filter_apply', 'sort_change', 'wishlist_add', 'wishlist_remove',
  'variant_select', 'color_select', 'gallery_image_change', 'signup', 'login',
  'newsletter_signup', 'contact_submit',
] as const;

const eventSchema = z.object({
  type: z.enum(EVENT_TYPES),
  path: z.string().max(512).optional(),
  productId: z.string().uuid().optional(),
  props: z.record(z.unknown()).optional(),
});

const batchSchema = z.object({
  visitorId: z.string().uuid(),
  sessionId: z.string().uuid(),
  userId: z.string().uuid().nullish(),
  events: z.array(eventSchema).min(1).max(20),
});

const summaryQuery = z.object({ days: z.enum(['7', '30', '90']).default('30') });

export function analyticsRoutes(analytics: AnalyticsService, jwtSecret: string) {
  const r = new Hono<AuthEnv>();

  // Public — batched beacon fired by the frontend tracker.
  r.post('/track', zValidator('json', batchSchema, zodHook), async (c) => {
    await analytics.recordBatch(c.req.valid('json'), c.req.header('User-Agent') ?? null);
    return c.body(null, 204);
  });

  r.get(
    '/analytics/summary',
    requireAuth(jwtSecret),
    requireAdmin,
    zValidator('query', summaryQuery, zodHook),
    async (c) => {
      const { days } = c.req.valid('query');
      return c.json(await analytics.summary(Number(days)));
    },
  );

  return r;
}
