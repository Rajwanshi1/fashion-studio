import { createMiddleware } from 'hono/factory';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window in-memory limiter keyed by client IP (first X-Forwarded-For
 * hop — the ALB appends the true client). Per-instance state: each ASG
 * instance enforces its own window; fleet-wide limiting is WAF's job.
 */
export function rateLimit({ windowMs, max, now = Date.now }: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  return createMiddleware(async (c, next) => {
    const t = now();
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt <= t) {
      if (buckets.size > 10_000) buckets.clear(); // bound memory; resets windows, acceptable
      buckets.set(ip, { count: 1, resetAt: t + windowMs });
    } else if (++bucket.count > max) {
      return c.json({ error: 'Too many requests' }, 429);
    }
    await next();
  });
}
