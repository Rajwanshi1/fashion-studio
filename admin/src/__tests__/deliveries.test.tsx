import { act, fireEvent, screen } from '@testing-library/react';
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

const soon = () =>
  makeOrder({
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

const overdue = () =>
  makeOrder({
    id: 'od2',
    orderNumber: 'TA-2026-05002',
    status: 'quality_check',
    channel: 'exhibition',
    deliveryDueDate: plusDays(-2),
    advancePaid: 18400000,
    balance: 0,
  });

/** The board itself, plus whatever else the test wants to answer. */
const board = (extra: (url: string, init?: RequestInit) => ReturnType<Parameters<typeof mockFetch>[0]>) =>
  mockFetch((url, init) => {
    if (url.endsWith('/api/admin/deliveries')) {
      return {
        json: {
          orders: [overdue(), soon()],
          totals: { pendingToCollect: 2500000, collectedCash: 2000000, collectedOnline: 0 },
        },
      };
    }
    return extra(url, init);
  });

describe('Deliveries page', () => {
  it('renders totals, buckets and the card links', async () => {
    seedAdminAuth();
    board(() => undefined);

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

    // Only the order that still owes money offers the payment shortcut.
    expect(
      screen.getByRole('button', { name: 'Record payment for TA-2026-05001' }),
    ).toBeInTheDocument();
    expect(
      screen.queryByRole('button', { name: 'Record payment for TA-2026-05002' }),
    ).not.toBeInTheDocument();
  });

  it('advances a card optimistically and PATCHes once the undo window closes', async () => {
    seedAdminAuth();
    const { calls } = board((url, init) =>
      url.includes('/api/admin/orders/od1') && init?.method === 'PATCH'
        ? { json: { ...soon(), status: 'quality_check' } }
        : undefined,
    );

    renderApp('/deliveries');
    await screen.findByText('To collect');

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: '→ Quality Check' }));

      // The card moves on immediately; the server has not been told yet.
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: '→ Quality Check' })).not.toBeInTheDocument();
      expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      const patches = calls.filter((c) => c.method === 'PATCH');
      expect(patches).toHaveLength(1);
      expect(patches[0].url).toContain('/api/admin/orders/od1');
      expect(patches[0].body).toEqual({ status: 'quality_check' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('Undo cancels the PATCH and puts the card back', async () => {
    seedAdminAuth();
    const { calls } = board(() => undefined);

    renderApp('/deliveries');
    await screen.findByText('To collect');

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: '→ Quality Check' }));
      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));

      // Back in the atelier — the same one-tap advance is on offer again.
      expect(screen.getByRole('button', { name: '→ Quality Check' })).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(30000);
      });
      expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('records a payment from the card and updates the balance', async () => {
    seedAdminAuth();
    const { calls } = board((url, init) =>
      url.endsWith('/api/admin/orders/od1/receipts') && init?.method === 'POST'
        ? {
            json: {
              ...soon(),
              advancePaid: 3000000,
              balance: 1500000,
            },
          }
        : undefined,
    );

    renderApp('/deliveries');
    await screen.findByText('To collect');

    await userEvent.click(screen.getByRole('button', { name: 'Record payment for TA-2026-05001' }));
    expect(await screen.findByRole('dialog', { name: 'Payment · Meera Kapoor' })).toBeInTheDocument();

    // Prefilled with the whole outstanding balance — the usual collection.
    const amount = screen.getByLabelText('Amount (₹)');
    expect(amount).toHaveValue(25000);
    await userEvent.clear(amount);
    await userEvent.type(amount, '10000');
    await userEvent.click(screen.getByRole('radio', { name: 'Online' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));

    const post = calls.find((c) => c.method === 'POST');
    expect(post?.url).toContain('/api/admin/orders/od1/receipts');
    expect(post?.body).toEqual({ amount: 1000000, mode: 'online' });

    // Sheet closes, and the card + money tiles carry the new numbers.
    expect(await screen.findByText('Payment of ₹10,000 recorded')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getAllByText('₹15,000').length).toBe(2); // card balance + to-collect tile
    expect(screen.getByText('₹10,000')).toBeInTheDocument(); // online received
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
