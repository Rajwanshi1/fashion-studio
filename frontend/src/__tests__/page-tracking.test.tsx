import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useNavigate } from 'react-router-dom';

// Split out from analytics.test.ts because it needs JSX (React component
// rendering) to exercise usePageTracking's dedup guard end-to-end.
//
// usePageTracking's dedup guard (lastPageViewKey) is a module-level
// variable, and MemoryRouter assigns the fixed key "default" to every
// router's *first* history entry regardless of path — so two tests in this
// file would otherwise collide (test 2's initial mount would look like a
// StrictMode-repeat of test 1's leftover key). vi.resetModules() + a fresh
// dynamic import per test (same convention as socials/track.test.ts) keeps
// each test's dedup state isolated.
async function loadUsePageTracking() {
  const mod = await import('../lib/analytics');
  return { usePageTracking: mod.usePageTracking, FLUSH_MS: mod.FLUSH_MS };
}

function setLocation(path: string) {
  window.history.replaceState({}, '', path);
}

function lastBody(fetchMock: ReturnType<typeof vi.fn>) {
  const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
  return JSON.parse(init.body as string) as { events: Array<{ type: string }> };
}

describe('usePageTracking', () => {
  beforeEach(() => {
    vi.resetModules();
    setLocation('/');
  });

  afterEach(() => {
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });

  it('dedupes React StrictMode double-invocation of the pageview effect (same location.key)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    const { usePageTracking, FLUSH_MS } = await loadUsePageTracking();
    function Tracked() {
      usePageTracking();
      return null;
    }

    render(
      <StrictMode>
        <MemoryRouter initialEntries={['/lookbook']}>
          <Tracked />
        </MemoryRouter>
      </StrictMode>,
    );

    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = lastBody(fetchMock);
    const pageViews = body.events.filter((e) => e.type === 'page_view');
    expect(pageViews).toHaveLength(1);
  });

  it('fires again on A -> B -> A navigation (each history entry gets a new location.key)', async () => {
    vi.useFakeTimers();
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);

    const { usePageTracking, FLUSH_MS } = await loadUsePageTracking();
    function Tracked() {
      usePageTracking();
      return null;
    }
    function Nav() {
      const navigate = useNavigate();
      return (
        <div>
          <button onClick={() => navigate('/b')}>to-b</button>
          <button onClick={() => navigate('/')}>to-a</button>
          <Tracked />
        </div>
      );
    }

    render(
      <MemoryRouter initialEntries={['/']}>
        <Nav />
      </MemoryRouter>,
    );

    fireEvent.click(screen.getByText('to-b'));
    fireEvent.click(screen.getByText('to-a'));

    await vi.advanceTimersByTimeAsync(FLUSH_MS);

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const body = lastBody(fetchMock);
    const pageViews = body.events.filter((e) => e.type === 'page_view');
    expect(pageViews).toHaveLength(3);
  });
});
