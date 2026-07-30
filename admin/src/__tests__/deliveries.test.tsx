import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { bucketDeliveries, daysBetween, relativeDue } from '../lib/deliveries';
import type { Order } from '../lib/types';
import { makeOrder, mockFetch, renderApp, seedAdminAuth } from '../test/utils';

/** Same clock basis as the page (Date.now → UTC ISO date). */
function plusDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
}

describe('bucketDeliveries', () => {
  const today = '2026-07-24';
  const order = (due: string | null, status: Order['status'] = 'in_atelier') =>
    makeOrder({ id: `o-${due}-${status}`, deliveryDueDate: due, status, channel: 'in_store' });

  it('buckets by day distance with inclusive 7/14/21 boundaries', () => {
    const buckets = bucketDeliveries(
      [
        order('2026-07-23'),
        order('2026-07-24'),
        order('2026-07-31'),
        order('2026-08-01'),
        order('2026-08-07'),
        order('2026-08-08'),
        order('2026-08-14'),
        order('2026-08-15'),
      ],
      today,
    );
    expect(buckets.overdue.map((o) => o.deliveryDueDate)).toEqual(['2026-07-23']);
    expect(buckets.next7.map((o) => o.deliveryDueDate)).toEqual(['2026-07-24', '2026-07-31']);
    expect(buckets.next14.map((o) => o.deliveryDueDate)).toEqual(['2026-08-01', '2026-08-07']);
    expect(buckets.next21.map((o) => o.deliveryDueDate)).toEqual(['2026-08-08', '2026-08-14']);
    expect(buckets.later.map((o) => o.deliveryDueDate)).toEqual(['2026-08-15']);
  });

  it('skips undated, delivered and cancelled orders', () => {
    const buckets = bucketDeliveries(
      [order(null), order('2026-07-25', 'delivered'), order('2026-07-25', 'cancelled')],
      today,
    );
    expect(Object.values(buckets).every((b) => b.length === 0)).toBe(true);
  });

  it('daysBetween and relativeDue phrase due dates', () => {
    expect(daysBetween(today, '2026-08-01')).toBe(8);
    expect(relativeDue(today, '2026-07-24')).toBe('today');
    expect(relativeDue(today, '2026-07-25')).toBe('tomorrow');
    expect(relativeDue(today, '2026-07-27')).toBe('in 3 days');
    expect(relativeDue(today, '2026-07-23')).toBe('1 day overdue');
    expect(relativeDue(today, '2026-07-22')).toBe('2 days overdue');
  });
});

describe('Deliveries page', () => {
  it('renders totals and buckets, and advances an order to its next status', async () => {
    seedAdminAuth();
    const soon = makeOrder({
      id: 'od1',
      orderNumber: 'TA-2026-05001',
      status: 'in_atelier',
      channel: 'in_store',
      billType: 'cash_memo',
      deliveryDueDate: plusDays(3),
      advancePaid: 2000000,
      balance: 2500000,
      total: 4500000,
      receipts: [
        {
          id: 'r1',
          orderId: 'od1',
          amount: 2000000,
          mode: 'cash',
          receivedAt: plusDays(-2),
          note: '',
          createdAt: '2026-07-20T10:00:00.000Z',
        },
      ],
    });
    const overdue = makeOrder({
      id: 'od2',
      orderNumber: 'TA-2026-05002',
      status: 'quality_check',
      channel: 'exhibition',
      deliveryDueDate: plusDays(-2),
      advancePaid: 18400000,
      balance: 0,
    });

    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/deliveries')) {
        return {
          json: {
            orders: [overdue, soon],
            totals: { pendingToCollect: 2500000, collectedCash: 2000000, collectedOnline: 0 },
          },
        };
      }
      if (url.includes('/api/admin/orders/od1') && init?.method === 'PATCH') {
        return { json: { ...soon, status: 'quality_check' } };
      }
      return undefined;
    });

    renderApp('/deliveries');

    // Sticky money tiles
    expect(await screen.findByText('To collect')).toBeInTheDocument();
    expect(screen.getAllByText('₹25,000').length).toBeGreaterThan(0); // tile + card balance
    expect(screen.getByText('Cash received')).toBeInTheDocument();

    // Buckets with counts; overdue card shows Paid in full
    expect(screen.getByText('Overdue')).toBeInTheDocument();
    expect(screen.getByText('Next 7 days')).toBeInTheDocument();
    expect(screen.getByText('Paid in full')).toBeInTheDocument();

    // Card actions: call, WhatsApp and maps links
    const wa = screen.getAllByRole('link', { name: 'WhatsApp' });
    expect(wa[0]).toHaveAttribute('href', expect.stringContaining('wa.me/919820000000'));
    expect(screen.getAllByRole('link', { name: 'Call' })[0]).toHaveAttribute(
      'href',
      expect.stringContaining('tel:'),
    );

    // Advance the in-atelier order one production step
    await userEvent.click(screen.getByRole('button', { name: '→ Quality Check' }));
    expect(await screen.findByText('TA-2026-05001 → Quality Check')).toBeInTheDocument();
    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.url).toContain('/api/admin/orders/od1');
    expect(patch?.body).toEqual({ status: 'quality_check' });
  });

  it('shows the empty-state hint when nothing has a due date', async () => {
    seedAdminAuth();
    mockFetch((url) =>
      url.endsWith('/api/admin/deliveries')
        ? { json: { orders: [], totals: { pendingToCollect: 0, collectedCash: 0, collectedOnline: 0 } } }
        : undefined,
    );
    renderApp('/deliveries');
    expect(await screen.findByText(/No delivery dates set/)).toBeInTheDocument();
  });
});
