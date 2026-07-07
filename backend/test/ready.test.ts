import { describe, expect, it } from 'vitest';
import { createApp } from '../src/app';
import { fakeTx, FakePaymentProvider, makeFakes } from './fakes';

const SECRET = 'ready-test-secret';

function makeTestApp(overrides: { pingDb?: () => Promise<void> } = {}) {
  return createApp({
    repos: makeFakes(),
    paymentProvider: new FakePaymentProvider(),
    jwtSecret: SECRET,
    corsOrigins: ['http://localhost:5173'],
    runInTransaction: fakeTx,
    ...overrides,
  });
}

describe('GET /api/ready', () => {
  it('returns 200 ready when the DB ping succeeds', async () => {
    const app = makeTestApp({ pingDb: async () => {} });
    const res = await app.request('/api/ready');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready' });
  });

  it('returns 503 when the DB ping fails', async () => {
    const app = makeTestApp({
      pingDb: async () => {
        throw new Error('down');
      },
    });
    const res = await app.request('/api/ready');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'unavailable' });
  });

  it('returns 503 when pingDb is not wired', async () => {
    const app = makeTestApp({});
    const res = await app.request('/api/ready');
    expect(res.status).toBe(503);
  });

  it('returns 200 for 310 consecutive requests without x-forwarded-for header', async () => {
    const app = makeTestApp({ pingDb: async () => {} });
    const requests = Array.from({ length: 310 }, () =>
      app.request('/api/ready', {
        headers: {
          // Omit x-forwarded-for to simulate ALB health checks that carry no header
        },
      }),
    );
    const responses = await Promise.all(requests);
    responses.forEach((res) => {
      expect(res.status).toBe(200);
    });
  });
});
