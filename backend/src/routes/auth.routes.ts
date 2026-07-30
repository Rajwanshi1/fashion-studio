import { zValidator } from '@hono/zod-validator';
import { Hono } from 'hono';
import { z } from 'zod';
import { AuthEnv, requireAuth } from '../middleware/auth';
import type { AuthService } from '../services/auth.service';
import { zodHook } from './hooks';

const registerSchema = z.object({
  email: z.string().email(),
  password: z.string().min(8),
  firstName: z.string().min(1),
  lastName: z.string().optional(),
});

const loginSchema = z.object({
  email: z.string().email(),
  password: z.string().min(1),
});

const googleSchema = z.object({
  credential: z.string().min(1),
});

const otpRequestSchema = z.object({
  phone: z.string().min(8).max(20),
});

const otpVerifySchema = z.object({
  phone: z.string().min(8).max(20),
  code: z.string().regex(/^\d{6}$/),
});

export function authRoutes(auth: AuthService, jwtSecret: string) {
  const r = new Hono<AuthEnv>();

  r.post('/register', zValidator('json', registerSchema, zodHook), async (c) => {
    const result = await auth.register(c.req.valid('json'));
    return c.json(result, 201);
  });

  r.post('/login', zValidator('json', loginSchema, zodHook), async (c) => {
    return c.json(await auth.login(c.req.valid('json')));
  });

  // Google Identity Services credential → our JWT. 503 until GOOGLE_CLIENT_ID is configured.
  r.post('/google', zValidator('json', googleSchema, zodHook), async (c) => {
    return c.json(await auth.loginWithGoogle(c.req.valid('json').credential));
  });

  // Phone OTP login. 503 until an SMS provider is configured.
  r.post('/otp/request', zValidator('json', otpRequestSchema, zodHook), async (c) => {
    return c.json(await auth.requestOtp(c.req.valid('json').phone));
  });

  r.post('/otp/verify', zValidator('json', otpVerifySchema, zodHook), async (c) => {
    return c.json(await auth.verifyOtp(c.req.valid('json')));
  });

  r.get('/me', requireAuth(jwtSecret), async (c) => {
    return c.json({ user: await auth.getUser(c.var.user!.id) });
  });

  return r;
}
