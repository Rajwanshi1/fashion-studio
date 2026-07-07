import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { AuthEnv, requireAdmin, requireAuth } from '../middleware/auth';
import type { SocialsService } from '../services/socials.service';
import { DomainError } from '../types';
import { zodHook } from './hooks';

const scanSchema = z.object({ source: z.string().min(1).max(200) });
const clickSchema = z.object({
  link: z.string().min(1).max(200),
  source: z.string().max(200).nullish(),
});

export function socialsRoutes(socials: SocialsService, jwtSecret: string) {
  const r = new Hono<AuthEnv>();

  // Public — hit by the QR/link redirect before the visitor lands on the socials page.
  r.post('/scan', zValidator('json', scanSchema, zodHook), async (c) => {
    const { source } = c.req.valid('json');
    try {
      await socials.recordScan(source, c.req.header('User-Agent') ?? null, c.req.header('Referer') ?? null);
    } catch (err) {
      // INVALID_SOURCE carries a machine-readable code (contract for the frontend);
      // every other error falls through to the app-wide { error: string } envelope.
      if (err instanceof DomainError && err.code === 'INVALID_SOURCE') {
        return c.json({ error: { code: err.code, message: err.message } }, 400);
      }
      throw err;
    }
    return c.body(null, 204);
  });

  // Public — beacon fired as the visitor leaves through one of the page's links.
  r.post('/click', zValidator('json', clickSchema, zodHook), async (c) => {
    const { link, source } = c.req.valid('json');
    try {
      await socials.recordClick(link, source ?? null, c.req.header('User-Agent') ?? null, c.req.header('Referer') ?? null);
    } catch (err) {
      if (err instanceof DomainError && err.code === 'INVALID_LINK') {
        return c.json({ error: { code: err.code, message: err.message } }, 400);
      }
      throw err;
    }
    return c.body(null, 204);
  });

  r.get('/stats', requireAuth(jwtSecret), requireAdmin, async (c) => {
    const [stats, clicks] = await Promise.all([socials.stats(), socials.clickStats()]);
    return c.json({ stats, clicks });
  });

  return r;
}
