import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';
import type { AnalyticsSummary } from '../lib/types';

function summaryFixture(): AnalyticsSummary {
  return {
    kpis: {
      sessions: 1000,
      orders: 40,
      revenue: 4800000,
      conversionRate: 0.04, // raw fraction, as the backend sends it — renders as "4.0%"
      cartAbandonmentRate: 0.625, // renders as "62.5%"
      aov: 120000,
    },
    funnel: [
      { stage: 'Sessions', sessions: 1000 },
      { stage: 'Product views', sessions: 620 },
      { stage: 'Added to cart', sessions: 160 },
      { stage: 'Checkout', sessions: 60 },
      { stage: 'Purchased', sessions: 40 },
    ],
    trend: [
      { day: '2026-07-10', sessions: 120, orders: 5 },
      { day: '2026-07-11', sessions: 140, orders: 6 },
    ],
    topProducts: [
      { productId: 'p1', name: 'Emerald Court Gown', views: 300, carts: 80, purchased: 20 },
    ],
    topSearches: [{ query: 'lehenga', searches: 45, lastAt: '2026-07-15T10:00:00Z' }],
    zeroSearches: [{ query: 'red saree size 40', searches: 3, lastAt: '2026-07-14T10:00:00Z' }],
    sources: [{ source: 'instagram', sessions: 300 }],
    devices: [{ device: 'mobile', sessions: 700 }],
    sizes: [{ size: 'M', adds: 90 }],
    colors: [{ color: 'Emerald', adds: 70 }],
  };
}

function zeroSummaryFixture(): AnalyticsSummary {
  return {
    kpis: {
      sessions: 0,
      orders: 0,
      revenue: 0,
      conversionRate: 0,
      cartAbandonmentRate: 0,
      aov: 0,
    },
    funnel: [
      { stage: 'Sessions', sessions: 0 },
      { stage: 'Product views', sessions: 0 },
      { stage: 'Added to cart', sessions: 0 },
      { stage: 'Checkout', sessions: 0 },
      { stage: 'Purchased', sessions: 0 },
    ],
    trend: [],
    topProducts: [],
    topSearches: [],
    zeroSearches: [],
    sources: [],
    devices: [],
    sizes: [],
    colors: [],
  };
}

describe('Analytics', () => {
  it('renders KPIs, the funnel with drop-offs, and top product rows', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.includes('/api/analytics/summary')) {
        return { json: summaryFixture() };
      }
      return undefined;
    });

    renderApp('/analytics');

    expect(await screen.findByRole('heading', { name: 'Analytics' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Analytics' })).toBeInTheDocument();

    // KPI cards (sessions count also matches the funnel's top stage, by design)
    expect((await screen.findAllByText('1,000')).length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText('4.0%')).toBeInTheDocument(); // conversion rate
    expect(screen.getByText('62.5%')).toBeInTheDocument(); // cart abandonment
    expect(screen.getByText('₹1,200')).toBeInTheDocument(); // AOV, paise → INR

    // funnel: stage labels + a drop-off %
    expect(screen.getAllByText('Sessions').length).toBeGreaterThanOrEqual(2); // KPI label + funnel stage
    expect(screen.getByText('Product views')).toBeInTheDocument();
    expect(screen.getByText('Added to cart')).toBeInTheDocument();
    expect(screen.getByText('Checkout')).toBeInTheDocument();
    expect(screen.getAllByText('Purchased').length).toBeGreaterThanOrEqual(2); // funnel stage + table column
    expect(screen.getByText('-38%')).toBeInTheDocument(); // 620 vs 1000 sessions

    // top product row + computed rate columns
    expect(screen.getByText('Emerald Court Gown')).toBeInTheDocument();
    expect(screen.getByText('26.7%')).toBeInTheDocument(); // 80/300 view→cart
    expect(screen.getByText('25.0%')).toBeInTheDocument(); // 20/80 cart→buy
  });

  it('refetches with ?days=7 when the 7 Days toggle is clicked', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url) => {
      if (url.includes('/api/analytics/summary')) {
        return { json: summaryFixture() };
      }
      return undefined;
    });

    renderApp('/analytics');
    await screen.findByRole('heading', { name: 'Analytics' });
    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('days=30'))).toBe(true),
    );

    await userEvent.click(screen.getByRole('button', { name: '7 Days' }));

    await waitFor(() =>
      expect(calls.some((c) => c.url.includes('/api/analytics/summary?days=7'))).toBe(true),
    );
  });

  it('shows an error note when the fetch fails', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.includes('/api/analytics/summary')) {
        return { status: 500, json: { error: 'Unable to load analytics' } };
      }
      return undefined;
    });

    renderApp('/analytics');

    expect(await screen.findByText('Unable to load analytics')).toBeInTheDocument();
  });

  it('renders an all-zero summary with no NaN, no Infinity, and empty-state notes', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.includes('/api/analytics/summary')) {
        return { json: zeroSummaryFixture() };
      }
      return undefined;
    });

    renderApp('/analytics');
    await screen.findByRole('heading', { name: 'Analytics' });

    expect(screen.queryByText(/NaN/)).not.toBeInTheDocument();
    expect(screen.queryByText(/Infinity/)).not.toBeInTheDocument();

    expect(screen.getByText('No funnel activity in this window.')).toBeInTheDocument();
    expect(screen.getByText('No sessions or orders in this window.')).toBeInTheDocument();
    expect(screen.getByText('No product activity in this window.')).toBeInTheDocument();
    expect(screen.getByText('No searches in this window.')).toBeInTheDocument();
    expect(screen.getByText('Every search found something.')).toBeInTheDocument();
  });
});
