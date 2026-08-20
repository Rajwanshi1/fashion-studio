import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';
import type { SessionEvent, SessionsPage, VisitorDetail } from '../lib/types';

const VISITOR = 'aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa';
const SESSION = 'bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb';

function sessionsFixture(): SessionsPage {
  return {
    sessions: [
      {
        sessionId: SESSION,
        visitorId: VISITOR,
        userId: null,
        startedAt: '2026-08-12T13:12:00Z', // 6:42 pm IST
        endedAt: '2026-08-12T13:16:32Z',
        durationSec: 272,
        device: 'mobile',
        landingPath: '/collection/lehenga',
        eventCount: 14,
        outcome: 'checkout',
        abandoned: true,
        orderId: null,
        orderNumber: null,
        ip: '203.0.113.9',
      },
      {
        sessionId: 'cccccccc-cccc-cccc-cccc-cccccccccccc',
        visitorId: VISITOR,
        userId: 'u1',
        startedAt: '2026-08-11T09:00:00Z',
        endedAt: '2026-08-11T09:20:00Z',
        durationSec: 1200,
        device: 'desktop',
        landingPath: '/',
        eventCount: 30,
        outcome: 'ordered',
        abandoned: false,
        orderId: 'o1',
        orderNumber: 'TA-2026-04817',
        ip: '198.51.100.4',
      },
    ],
    total: 2,
    page: 1,
    pageSize: 50,
  };
}

function timelineFixture(): SessionEvent[] {
  return [
    {
      eventType: 'session_start',
      occurredAt: '2026-08-12T13:12:00Z',
      path: '/collection/lehenga',
      productId: null,
      productName: null,
      props: { referrer: 'https://instagram.com/' },
    },
    {
      eventType: 'product_view',
      occurredAt: '2026-08-12T13:12:45Z',
      path: '/product/sage-sequin-jacket-lehenga',
      productId: 'p1',
      productName: 'Sage Sequin Jacket Lehenga',
      props: {},
    },
  ];
}

function visitorFixture(): VisitorDetail {
  return {
    visitorId: VISITOR,
    sessions: sessionsFixture().sessions,
    sameIpSessions: 3,
  };
}

describe('Sessions', () => {
  it('renders the list with outcome badges, order number, duration and ip', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.includes('/api/analytics/sessions?')) return { json: sessionsFixture() };
      return undefined;
    });

    renderApp('/sessions');

    expect(await screen.findByRole('heading', { name: 'Sessions' })).toBeInTheDocument();
    // Each outcome word also names a filter chip — scope to the badges.
    expect(screen.getByText('Ordered', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText('Checkout', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText('Abandoned', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText('TA-2026-04817')).toBeInTheDocument();
    expect(screen.getByText('4m 32s')).toBeInTheDocument();
    expect(screen.getByText('20m 0s')).toBeInTheDocument();
    expect(screen.getByText('/collection/lehenga')).toBeInTheDocument();
    expect(screen.getByText('203.0.113.9')).toBeInTheDocument();
    // IST rendering of 2026-08-12T13:12:00Z
    expect(screen.getByText(/12 Aug 2026/)).toBeInTheDocument();
  });

  it('refetches when the day and outcome chips change, resetting to page 1', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url) => {
      if (url.includes('/api/analytics/sessions?')) return { json: sessionsFixture() };
      return undefined;
    });

    renderApp('/sessions');
    await screen.findByRole('heading', { name: 'Sessions' });
    await waitFor(() => expect(calls.some((c) => c.url.includes('days=30&outcome=all&page=1'))).toBe(true));

    await userEvent.click(screen.getByRole('button', { name: '7 Days' }));
    await waitFor(() => expect(calls.some((c) => c.url.includes('days=7&outcome=all&page=1'))).toBe(true));

    await userEvent.click(screen.getByRole('button', { name: 'Abandoned' }));
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('days=7&outcome=abandoned&page=1'))).toBe(true),
    );
  });

  it('expands a row into its fetched timeline', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.includes(`/api/analytics/sessions/${SESSION}`)) return { json: timelineFixture() };
      if (url.includes('/api/analytics/sessions?')) return { json: sessionsFixture() };
      return undefined;
    });

    renderApp('/sessions');
    await userEvent.click(await screen.findByText('4m 32s')); // the row itself

    expect(await screen.findByText('product view')).toBeInTheDocument();
    expect(screen.getByText('Sage Sequin Jacket Lehenga')).toBeInTheDocument();
    expect(screen.getByText('+0:45')).toBeInTheDocument();
    expect(screen.getByText(/referrer: https:\/\/instagram\.com\//)).toBeInTheDocument();
  });

  it('visitor mode (?visitor=) shows that visitor’s sessions and the same-IP hint', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.includes(`/api/analytics/visitors/${VISITOR}`)) return { json: visitorFixture() };
      return undefined;
    });

    renderApp(`/sessions?visitor=${VISITOR}`);

    expect(await screen.findByText(/3 session\(s\) from other visitors/)).toBeInTheDocument();
    expect(screen.getByText('TA-2026-04817')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '← All sessions' })).toBeInTheDocument();
    // The list-mode filter chips are hidden in visitor mode.
    expect(screen.queryByRole('button', { name: '7 Days' })).not.toBeInTheDocument();
  });

  it('shows an error note when the fetch fails', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.includes('/api/analytics/sessions?')) {
        return { status: 500, json: { error: 'Unable to load sessions' } };
      }
      return undefined;
    });

    renderApp('/sessions');

    expect(await screen.findByText('Unable to load sessions')).toBeInTheDocument();
  });
});
