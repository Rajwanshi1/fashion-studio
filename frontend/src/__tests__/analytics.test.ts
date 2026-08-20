import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FLUSH_MS, MAX_BATCH, TRACK_ENDPOINT, getSessionId, getVisitorId, track } from '../lib/analytics';

/** analytics.ts registers module-level pagehide/visibilitychange listeners
 *  once, guarded by a flag — so (unlike track.test.ts) we do NOT re-import a
 *  fresh module per test via vi.resetModules(); that would stack a fresh
 *  pair of window/document listeners on every test. Instead this is one
 *  static import for the whole file, and every test fully drains its own
 *  queue (via a timer advance, hitting MAX_BATCH, or dispatching
 *  pagehide/visibilitychange) before it ends, so nothing bleeds into the
 *  next test. localStorage is cleared globally after each test
 *  (setupTests.ts), which is what makes every test's first track() call
 *  rotate the session and enqueue a fresh session_start. */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

function setLocation(path: string) {
  window.history.replaceState({}, '', path);
}

function eventTypes(body: { events: Array<{ type: string }> }): string[] {
  return body.events.map((e) => e.type);
}

function lastBody(fetchMock: ReturnType<typeof vi.fn>, callIndex = 0) {
  const [, init] = fetchMock.mock.calls[callIndex] as [string, RequestInit];
  return JSON.parse(init.body as string);
}

describe('analytics', () => {
  beforeEach(() => {
    setLocation('/');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
    delete (navigator as unknown as Record<string, unknown>).sendBeacon;
    // Object.defineProperty(document, 'referrer'/'visibilityState', ...) adds
    // an own-property override that shadows jsdom's getter indefinitely —
    // clear it so later tests see the real (default) values again.
    delete (document as unknown as Record<string, unknown>).referrer;
    delete (document as unknown as Record<string, unknown>).visibilityState;
  });

  it('batches events until the 10s timer fires, then POSTs once with the envelope', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    track('product_view', { productId: 'p1' });
    track('add_to_cart', { productId: 'p1' });
    expect(fetchMock).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TRACK_ENDPOINT);
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });

    const body = lastBody(fetchMock);
    expect(body.visitorId).toMatch(UUID_RE);
    expect(body.sessionId).toMatch(UUID_RE);
    // First-ever track() after localStorage was cleared rotates the
    // session, so session_start leads, followed by both triggering events.
    expect(eventTypes(body)).toEqual(['session_start', 'product_view', 'add_to_cart']);
  });

  it('stamps occurredAt at queue time, not flush time', async () => {
    vi.useFakeTimers();
    const queuedAt = new Date('2026-08-13T10:00:00Z').getTime();
    vi.setSystemTime(queuedAt);
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    track('product_view', { productId: 'p1' });
    // The flush happens FLUSH_MS later — occurredAt must still be queue time.
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    const body = lastBody(fetchMock);
    expect(body.events).toHaveLength(2); // session_start + product_view
    expect(body.events.every((e: { occurredAt: number }) => e.occurredAt === queuedAt)).toBe(true);
  });

  it('exposes the tracker identity via getVisitorId/getSessionId, matching the envelope', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    const visitorId = getVisitorId();
    const sessionId = getSessionId();
    expect(visitorId).toMatch(UUID_RE);
    expect(sessionId).toMatch(UUID_RE);

    track('page_view');
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    const body = lastBody(fetchMock);
    expect(body.visitorId).toBe(visitorId);
    // Reading the session id counted as activity, so track() saw a live
    // session and did not rotate it.
    expect(body.sessionId).toBe(sessionId);
    expect(eventTypes(body)).toEqual(['page_view']);
  });

  it('flushes immediately once 20 events are queued, without a timer advance', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    // Call #1 also enqueues session_start (2 events); 18 more calls bring
    // the queue to exactly MAX_BATCH, tripping it on the 19th track() call.
    for (let i = 0; i < 19; i++) track('search', { props: { q: String(i) } });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(lastBody(fetchMock).events).toHaveLength(MAX_BATCH);
  });

  it('rotates the session (with a leading session_start) after 30+ min idle, not after only 5', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    track('product_view');
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const first = lastBody(fetchMock, 0);
    expect(eventTypes(first)).toEqual(['session_start', 'product_view']);
    const sessionId1 = first.sessionId as string;

    // Only 5 minutes idle — same session, no session_start.
    vi.advanceTimersByTime(5 * 60 * 1000);
    track('search');
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    const second = lastBody(fetchMock, 1);
    expect(second.sessionId).toBe(sessionId1);
    expect(eventTypes(second)).toEqual(['search']);

    // 31 minutes idle — session rotates, new session_start leads.
    vi.advanceTimersByTime(31 * 60 * 1000);
    track('search');
    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    const third = lastBody(fetchMock, 2);
    expect(third.sessionId).not.toBe(sessionId1);
    expect(eventTypes(third)).toEqual(['session_start', 'search']);
  });

  it('captures referrer + utm props on session_start, landing set to the page that started it', async () => {
    vi.useFakeTimers();
    setLocation('/collections?utm_source=ig&utm_medium=story&utm_campaign=summer');
    Object.defineProperty(document, 'referrer', {
      value: 'https://instagram.com/',
      configurable: true,
    });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    track('page_view');
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    const body = lastBody(fetchMock);
    const sessionStart = body.events.find((e: { type: string }) => e.type === 'session_start');
    expect(sessionStart.props).toEqual({
      referrer: 'https://instagram.com/',
      utmSource: 'ig',
      utmMedium: 'story',
      utmCampaign: 'summer',
      landing: '/collections',
    });
  });

  it('nulls out utm props and referrer when absent', async () => {
    vi.useFakeTimers();
    setLocation('/');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    track('page_view');
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    const body = lastBody(fetchMock);
    const sessionStart = body.events.find((e: { type: string }) => e.type === 'session_start');
    expect(sessionStart.props.referrer).toBeNull();
    expect(sessionStart.props.utmSource).toBeNull();
    expect(sessionStart.props.utmMedium).toBeNull();
    expect(sessionStart.props.utmCampaign).toBeNull();
  });

  it('never throws when localStorage is blocked, and still posts using in-memory ids', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    const originalLocalStorage = window.localStorage;
    Object.defineProperty(window, 'localStorage', {
      configurable: true,
      get() {
        throw new DOMException('The operation is insecure.', 'SecurityError');
      },
    });

    try {
      expect(() => track('page_view')).not.toThrow();
      await vi.advanceTimersByTimeAsync(FLUSH_MS);
    } finally {
      Object.defineProperty(window, 'localStorage', {
        configurable: true,
        writable: true,
        value: originalLocalStorage,
      });
    }

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = lastBody(fetchMock);
    expect(body.visitorId).toMatch(UUID_RE);
    expect(body.sessionId).toMatch(UUID_RE);
    expect(eventTypes(body)).toEqual(['session_start', 'page_view']);
  });

  it('self-heals a corrupted ta.session by clearing it, so the next load can persist a session again', async () => {
    // Deliberately corrupt the stored session record (bad JSON) rather than
    // block localStorage outright — this exercises the JSON.parse failure
    // path specifically, distinct from the "storage blocked entirely" test
    // above. Both fall into the same catch, whose in-memory fallback is
    // module-level state shared across this file's tests — so, unlike other
    // tests here, this one intentionally avoids asserting *which* session id
    // comes back or whether it rotated (that depends on fallback state the
    // test above already touched). What Fix 4 guarantees, and all this test
    // asserts, is that the corrupted stored value itself gets cleared instead
    // of poisoning every future read.
    vi.useFakeTimers();
    localStorage.setItem('ta.session', 'not-valid-json{');
    const removeSpy = vi.spyOn(Storage.prototype, 'removeItem');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    // The corrupted read falls into the catch path; the call must never throw.
    expect(() => track('page_view')).not.toThrow();
    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    expect(removeSpy).toHaveBeenCalledWith('ta.session');
    // Cleared, not left corrupted — the next load's getItem sees null
    // (missing) rather than unparseable JSON, so it can self-heal back to a
    // persisted session instead of permanently degrading to per-load ones.
    expect(localStorage.getItem('ta.session')).toBeNull();

    const body = lastBody(fetchMock);
    expect(body.sessionId).toMatch(UUID_RE);

    removeSpy.mockRestore();
  });

  it('uses sendBeacon on pagehide when present', async () => {
    track('page_view');

    const sendBeacon = vi.fn().mockReturnValue(true);
    navigator.sendBeacon = sendBeacon;
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    const [url, blob] = sendBeacon.mock.calls[0] as [string, Blob];
    expect(url).toBe(TRACK_ENDPOINT);
    expect(blob).toBeInstanceOf(Blob);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to fetch keepalive when sendBeacon returns false', async () => {
    track('page_view');

    const sendBeacon = vi.fn().mockReturnValue(false);
    navigator.sendBeacon = sendBeacon;
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    window.dispatchEvent(new Event('pagehide'));

    expect(sendBeacon).toHaveBeenCalledTimes(1);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TRACK_ENDPOINT);
    expect(init.keepalive).toBe(true);
  });

  it('falls back to fetch keepalive when sendBeacon is absent altogether', async () => {
    track('page_view');

    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    window.dispatchEvent(new Event('pagehide'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(TRACK_ENDPOINT);
    expect(init.keepalive).toBe(true);
  });

  it('flushes on visibilitychange when the tab becomes hidden', async () => {
    track('page_view');

    Object.defineProperty(document, 'visibilityState', { value: 'hidden', configurable: true });
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    document.dispatchEvent(new Event('visibilitychange'));

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('swallows a rejected fetch without throwing (fire-and-forget)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    expect(() => track('page_view')).not.toThrow();

    await vi.advanceTimersByTimeAsync(FLUSH_MS);
    // Let the rejected promise's .catch() run — an unhandled rejection here
    // would fail the test run.
    await Promise.resolve();
    await Promise.resolve();

    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
