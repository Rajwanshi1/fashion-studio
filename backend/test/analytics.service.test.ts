import { describe, expect, it } from 'vitest';
import { classifyDevice, createAnalyticsService } from '../src/services/analytics.service';
import { FakeEventsRepo } from './fakes';

const VISITOR = '11111111-1111-1111-1111-111111111111';
const SESSION = '22222222-2222-2222-2222-222222222222';
const USER = '33333333-3333-3333-3333-333333333333';
const PRODUCT = '44444444-4444-4444-4444-444444444444';

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Mobile/15E148';
const ANDROID_UA = 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Mobile Safari/537.36';
const DESKTOP_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36';

describe('classifyDevice', () => {
  it.each([
    [IPHONE_UA, 'mobile'],
    [ANDROID_UA, 'mobile'],
    [DESKTOP_UA, 'desktop'],
    [null, 'desktop'],
  ] as const)('classifyDevice(%j) -> %j', (ua, expected) => {
    expect(classifyDevice(ua)).toBe(expected);
  });
});

describe('AnalyticsService.recordBatch', () => {
  it('derives one device per batch from the request User-Agent and applies it to every event', async () => {
    const events = new FakeEventsRepo();
    const service = createAnalyticsService({ events });
    await service.recordBatch(
      { visitorId: VISITOR, sessionId: SESSION, events: [{ type: 'page_view' }, { type: 'product_view' }] },
      IPHONE_UA,
    );
    expect(events.rows).toHaveLength(2);
    expect(events.rows.every((r) => r.device === 'mobile')).toBe(true);
  });

  it('classifies desktop for a desktop UA', async () => {
    const events = new FakeEventsRepo();
    const service = createAnalyticsService({ events });
    await service.recordBatch({ visitorId: VISITOR, sessionId: SESSION, events: [{ type: 'page_view' }] }, DESKTOP_UA);
    expect(events.rows[0].device).toBe('desktop');
  });

  it('classifies desktop when the User-Agent header is absent (null)', async () => {
    const events = new FakeEventsRepo();
    const service = createAnalyticsService({ events });
    await service.recordBatch({ visitorId: VISITOR, sessionId: SESSION, events: [{ type: 'page_view' }] }, null);
    expect(events.rows[0].device).toBe('desktop');
  });

  it('truncates an oversized path to 512 chars', async () => {
    const events = new FakeEventsRepo();
    const service = createAnalyticsService({ events });
    const longPath = '/' + 'a'.repeat(600);
    await service.recordBatch(
      { visitorId: VISITOR, sessionId: SESSION, events: [{ type: 'page_view', path: longPath }] },
      null,
    );
    expect(events.rows[0].path).toHaveLength(512);
    expect(events.rows[0].path).toBe(longPath.slice(0, 512));
  });

  it('keeps a short path unchanged and defaults a missing path to null', async () => {
    const events = new FakeEventsRepo();
    const service = createAnalyticsService({ events });
    await service.recordBatch(
      { visitorId: VISITOR, sessionId: SESSION, events: [{ type: 'page_view', path: '/shop' }, { type: 'login' }] },
      null,
    );
    expect(events.rows[0].path).toBe('/shop');
    expect(events.rows[1].path).toBeNull();
  });

  it('drops oversized props (stringified > 2048 chars) but keeps the event', async () => {
    const events = new FakeEventsRepo();
    const service = createAnalyticsService({ events });
    const bigProps = { blob: 'x'.repeat(2100) };
    expect(JSON.stringify(bigProps).length).toBeGreaterThan(2048);
    await service.recordBatch(
      { visitorId: VISITOR, sessionId: SESSION, events: [{ type: 'search', props: bigProps }] },
      null,
    );
    expect(events.rows).toHaveLength(1);
    expect(events.rows[0].props).toEqual({});
    expect(events.rows[0].eventType).toBe('search');
  });

  it('keeps props at or under the 2048-char limit as-is, and defaults a missing props to {}', async () => {
    const events = new FakeEventsRepo();
    const service = createAnalyticsService({ events });
    const props = { q: 'sequin lehenga' };
    await service.recordBatch(
      { visitorId: VISITOR, sessionId: SESSION, events: [{ type: 'search', props }, { type: 'page_view' }] },
      null,
    );
    expect(events.rows[0].props).toEqual(props);
    expect(events.rows[1].props).toEqual({});
  });

  it('passes userId through when present, and defaults to null when absent or explicitly null', async () => {
    const events = new FakeEventsRepo();
    const service = createAnalyticsService({ events });
    await service.recordBatch({ visitorId: VISITOR, sessionId: SESSION, userId: USER, events: [{ type: 'login' }] }, null);
    expect(events.rows[0].userId).toBe(USER);

    await service.recordBatch({ visitorId: VISITOR, sessionId: SESSION, events: [{ type: 'page_view' }] }, null);
    expect(events.rows[1].userId).toBeNull();

    await service.recordBatch(
      { visitorId: VISITOR, sessionId: SESSION, userId: null, events: [{ type: 'page_view' }] },
      null,
    );
    expect(events.rows[2].userId).toBeNull();
  });

  it('passes eventType, visitorId, sessionId and productId through unchanged; defaults productId to null', async () => {
    const events = new FakeEventsRepo();
    const service = createAnalyticsService({ events });
    await service.recordBatch(
      {
        visitorId: VISITOR,
        sessionId: SESSION,
        events: [{ type: 'product_view', productId: PRODUCT }, { type: 'page_view' }],
      },
      null,
    );
    expect(events.rows[0]).toMatchObject({
      eventType: 'product_view',
      visitorId: VISITOR,
      sessionId: SESSION,
      productId: PRODUCT,
    });
    expect(events.rows[1].productId).toBeNull();
  });

  it('calls events.insertBatch exactly once per recordBatch call', async () => {
    const events = new FakeEventsRepo();
    let calls = 0;
    const counting = { insertBatch: (rows: any) => { calls++; return events.insertBatch(rows); } };
    const service = createAnalyticsService({ events: counting as any });
    await service.recordBatch(
      { visitorId: VISITOR, sessionId: SESSION, events: [{ type: 'page_view' }, { type: 'product_view' }] },
      null,
    );
    expect(calls).toBe(1);
    expect(events.rows).toHaveLength(2);
  });
});

describe('AnalyticsService.summary', () => {
  const SESSION_2 = '55555555-5555-5555-5555-555555555555';
  const SESSION_3 = '66666666-6666-6666-6666-666666666666';

  function setup() {
    const events = new FakeEventsRepo();
    return { events, service: createAnalyticsService({ events }) };
  }

  it('returns all-zero kpis (never NaN/Infinity) when there is no data at all', async () => {
    const { service } = setup();
    const summary = await service.summary(30);
    expect(summary.kpis).toEqual({
      sessions: 0,
      orders: 0,
      revenue: 0,
      conversionRate: 0,
      cartAbandonmentRate: 0,
      aov: 0,
    });
    // trend is gap-filled — always `days` entries, all zero when there's no data.
    expect(summary.trend).toHaveLength(30);
    expect(summary.trend.every((d) => d.sessions === 0 && d.orders === 0)).toBe(true);
    expect(summary.topProducts).toEqual([]);
  });

  it('funnel stages are the 5 fixed labels in fixed order', async () => {
    const { service } = setup();
    const summary = await service.summary(30);
    expect(summary.funnel.map((f) => f.stage)).toEqual([
      'Sessions',
      'Product views',
      'Added to cart',
      'Checkout',
      'Purchased',
    ]);
  });

  it('conversionRate and aov are 0 (not NaN) when sessions exist but zero orders', async () => {
    const { events, service } = setup();
    await events.insertBatch([
      { eventType: 'session_start', visitorId: VISITOR, sessionId: SESSION, userId: null, path: null, productId: null, device: 'desktop', props: {} },
    ]);
    const summary = await service.summary(30);
    expect(summary.kpis.sessions).toBe(1);
    expect(summary.kpis.conversionRate).toBe(0);
    expect(summary.kpis.cartAbandonmentRate).toBe(0);
    expect(summary.kpis.aov).toBe(0);
  });

  it('cartAbandonmentRate is 1 (fully abandoned) when carts exist but zero orders', async () => {
    const { events, service } = setup();
    await events.insertBatch([
      { eventType: 'add_to_cart', visitorId: VISITOR, sessionId: SESSION, userId: null, path: null, productId: PRODUCT, device: 'desktop', props: {} },
    ]);
    const summary = await service.summary(30);
    expect(summary.kpis.cartAbandonmentRate).toBe(1);
    expect(summary.kpis.aov).toBe(0);
  });

  it('clamps cartAbandonmentRate to 0 (never negative) when order sessions exceed cart sessions', async () => {
    const { events, service } = setup();
    await events.insertBatch([
      { eventType: 'add_to_cart', visitorId: VISITOR, sessionId: SESSION, userId: null, path: null, productId: null, device: 'desktop', props: {} },
      { eventType: 'order_placed', visitorId: VISITOR, sessionId: SESSION, userId: null, path: null, productId: null, device: 'desktop', props: { total: 100 } },
      { eventType: 'order_placed', visitorId: VISITOR, sessionId: SESSION_2, userId: null, path: null, productId: null, device: 'desktop', props: { total: 200 } },
    ]);
    const summary = await service.summary(30);
    expect(summary.kpis.cartAbandonmentRate).toBe(0);
  });

  it('computes conversionRate, cartAbandonmentRate and a rounded aov from realistic counts', async () => {
    const { events, service } = setup();
    // 10 distinct sessions, 5 of which add to cart, 3 of which order.
    const sessionIds = Array.from({ length: 10 }, (_, i) => `77777777-7777-7777-7777-77777777770${i}`);
    for (const sid of sessionIds) {
      await events.insertBatch([
        { eventType: 'session_start', visitorId: VISITOR, sessionId: sid, userId: null, path: null, productId: null, device: 'desktop', props: {} },
      ]);
    }
    for (const sid of sessionIds.slice(0, 5)) {
      await events.insertBatch([
        { eventType: 'add_to_cart', visitorId: VISITOR, sessionId: sid, userId: null, path: null, productId: PRODUCT, device: 'desktop', props: {} },
      ]);
    }
    // orders: 100 + 250 + 175 = 525 paise across 3 orders -> aov = round(525/3) = 175
    const totals = [100, 250, 175];
    for (const [i, sid] of sessionIds.slice(0, 3).entries()) {
      await events.insertBatch([
        { eventType: 'order_placed', visitorId: VISITOR, sessionId: sid, userId: null, path: null, productId: null, device: 'desktop', props: { total: totals[i] } },
      ]);
    }
    const summary = await service.summary(30);
    expect(summary.kpis.sessions).toBe(10);
    expect(summary.kpis.orders).toBe(3);
    expect(summary.kpis.revenue).toBe(525);
    expect(summary.kpis.conversionRate).toBeCloseTo(0.3);
    expect(summary.kpis.cartAbandonmentRate).toBeCloseTo(0.4); // (5-3)/5
    expect(summary.kpis.aov).toBe(175);
  });

  it('rounds aov to the nearest integer paise', async () => {
    const { events, service } = setup();
    await events.insertBatch([
      { eventType: 'order_placed', visitorId: VISITOR, sessionId: SESSION, userId: null, path: null, productId: null, device: 'desktop', props: { total: 100 } },
      { eventType: 'order_placed', visitorId: VISITOR, sessionId: SESSION_2, userId: null, path: null, productId: null, device: 'desktop', props: { total: 101 } },
      { eventType: 'order_placed', visitorId: VISITOR, sessionId: SESSION_3, userId: null, path: null, productId: null, device: 'desktop', props: { total: 101 } },
    ]);
    const summary = await service.summary(30);
    // 302 / 3 = 100.666... -> rounds to 101
    expect(summary.kpis.aov).toBe(101);
  });
});
