import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { rateLimit } from '../src/middleware/rate-limit';

function appWithLimit(max: number, now: () => number) {
  const app = new Hono();
  app.use('/x/*', rateLimit({ windowMs: 60_000, max, now }));
  app.get('/x/ping', (c) => c.json({ ok: true }));
  return app;
}

const from = (ip: string) => ({ headers: { 'x-forwarded-for': `${ip}, 10.20.0.5` } });

describe('rateLimit', () => {
  it('allows up to max requests then returns 429', async () => {
    const app = appWithLimit(3, () => 1_000);
    for (let i = 0; i < 3; i++) {
      expect((await app.request('/x/ping', from('1.2.3.4'))).status).toBe(200);
    }
    const blocked = await app.request('/x/ping', from('1.2.3.4'));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'Too many requests' });
  });

  it('tracks IPs independently (first X-Forwarded-For hop)', async () => {
    const app = appWithLimit(1, () => 1_000);
    expect((await app.request('/x/ping', from('1.1.1.1'))).status).toBe(200);
    expect((await app.request('/x/ping', from('2.2.2.2'))).status).toBe(200);
    expect((await app.request('/x/ping', from('1.1.1.1'))).status).toBe(429);
  });

  it('resets after the window elapses', async () => {
    let t = 1_000;
    const app = appWithLimit(1, () => t);
    expect((await app.request('/x/ping', from('9.9.9.9'))).status).toBe(200);
    expect((await app.request('/x/ping', from('9.9.9.9'))).status).toBe(429);
    t += 61_000;
    expect((await app.request('/x/ping', from('9.9.9.9'))).status).toBe(200);
  });
});
