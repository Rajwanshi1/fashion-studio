import type { MiddlewareHandler } from 'hono';
import { verify } from 'hono/jwt';
import { Role } from '../types';

export interface AuthUser {
  id: string;
  email: string;
  role: Role;
}

/** Hono env used across the app so c.var.user is typed. */
export type AuthEnv = { Variables: { user?: AuthUser } };

async function userFromHeader(header: string | undefined, jwtSecret: string): Promise<AuthUser | null> {
  if (!header?.startsWith('Bearer ')) return null;
  try {
    const payload = await verify(header.slice('Bearer '.length), jwtSecret, 'HS256');
    if (typeof payload.sub !== 'string') return null;
    return {
      id: payload.sub,
      email: typeof payload.email === 'string' ? payload.email : '',
      role: payload.role === 'admin' ? 'admin' : 'customer',
    };
  } catch {
    return null;
  }
}

/** Requires a valid Bearer JWT; sets c.var.user. */
export function requireAuth(jwtSecret: string): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const user = await userFromHeader(c.req.header('Authorization'), jwtSecret);
    if (!user) return c.json({ error: 'Unauthorized' }, 401);
    c.set('user', user);
    await next();
  };
}

/** Sets c.var.user when a valid Bearer JWT is present; always continues. */
export function optionalAuth(jwtSecret: string): MiddlewareHandler<AuthEnv> {
  return async (c, next) => {
    const user = await userFromHeader(c.req.header('Authorization'), jwtSecret);
    if (user) c.set('user', user);
    await next();
  };
}

/** Must run after requireAuth. */
export const requireAdmin: MiddlewareHandler<AuthEnv> = async (c, next) => {
  if (c.var.user?.role !== 'admin') return c.json({ error: 'Forbidden' }, 403);
  await next();
};
