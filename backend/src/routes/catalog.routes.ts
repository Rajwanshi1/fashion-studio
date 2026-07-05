import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import type { WishlistRepo } from '../data/products.repo';
import { AuthEnv, requireAuth } from '../middleware/auth';
import type { CatalogService } from '../services/catalog.service';
import { zodHook } from './hooks';

const listQuerySchema = z.object({
  category: z.string().optional(),
  search: z.string().optional(),
  sort: z.enum(['featured', 'new', 'price_asc', 'price_desc']).optional(),
  page: z.coerce.number().int().min(1).optional(),
  limit: z.coerce.number().int().min(1).max(100).optional(),
});

export function catalogRoutes(catalog: CatalogService, wishlist: WishlistRepo, jwtSecret: string) {
  const r = new Hono<AuthEnv>();

  r.get('/categories', async (c) => c.json(await catalog.listCategories()));

  r.get('/products', zValidator('query', listQuerySchema, zodHook), async (c) => {
    return c.json(await catalog.listProducts(c.req.valid('query')));
  });

  r.get('/products/:slug', async (c) => {
    return c.json(await catalog.getProduct(c.req.param('slug')));
  });

  r.get('/me/wishlist', requireAuth(jwtSecret), async (c) => {
    return c.json(await wishlist.list(c.var.user!.id));
  });

  r.put('/me/wishlist/:productId', requireAuth(jwtSecret), async (c) => {
    await wishlist.add(c.var.user!.id, c.req.param('productId'));
    return c.json(await wishlist.list(c.var.user!.id));
  });

  r.delete('/me/wishlist/:productId', requireAuth(jwtSecret), async (c) => {
    await wishlist.remove(c.var.user!.id, c.req.param('productId'));
    return c.json(await wishlist.list(c.var.user!.id));
  });

  return r;
}
