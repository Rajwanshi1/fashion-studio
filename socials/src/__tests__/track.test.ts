import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/** track.ts keeps a module-level `sent` guard, so each test must get a fresh
 *  module instance (vi.resetModules) to isolate that state — otherwise the
 *  first test's post would poison every test after it. sessionStorage is a
 *  real jsdom global and persists across resetModules, which is exactly what
 *  we want: it's how we simulate "already logged this browser session". */
async function loadTrackScan() {
  const mod = await import('../track');
  return mod.trackScan;
}

function setLocation(search: string) {
  window.history.replaceState({}, '', `/${search}`);
}

describe('trackScan', () => {
  beforeEach(() => {
    vi.resetModules();
    sessionStorage.clear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('posts the scan source once, with keepalive, then scrubs the URL', async () => {
    setLocation('?src=Store-Window');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    const trackScan = await loadTrackScan();
    trackScan();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('http://localhost:3001/api/socials/scan');
    expect(init.method).toBe('POST');
    expect(init.keepalive).toBe(true);
    expect(init.headers).toMatchObject({ 'content-type': 'application/json' });
    expect(JSON.parse(init.body as string)).toEqual({ source: 'Store-Window' });

    // history.replaceState must leave the URL clean — no src/utm_source.
    expect(window.location.search).toBe('');
    expect(window.location.pathname).toBe('/');
  });

  it('reads utm_source as a fallback when src is absent', async () => {
    setLocation('?utm_source=Postcard');
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    const trackScan = await loadTrackScan();
    trackScan();

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(JSON.parse(init.body as string)).toEqual({ source: 'Postcard' });
  });

  it('does nothing when there is no src or utm_source param', async () => {
    setLocation('');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const trackScan = await loadTrackScan();
    trackScan();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('does not post again when this session already logged a scan', async () => {
    setLocation('?src=Store-Window');
    sessionStorage.setItem('ta-scan-logged', '1');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const trackScan = await loadTrackScan();
    trackScan();

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('swallows a rejected fetch without throwing', async () => {
    setLocation('?src=Store-Window');
    const fetchMock = vi.fn().mockRejectedValue(new Error('network down'));
    vi.stubGlobal('fetch', fetchMock);

    const trackScan = await loadTrackScan();
    expect(() => trackScan()).not.toThrow();

    // Let the rejected promise's .catch() run — an unhandled rejection here
    // would fail the test run.
    await Promise.resolve();
    await Promise.resolve();
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });
});
