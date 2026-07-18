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
