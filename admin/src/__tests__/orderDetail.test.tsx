import { act, fireEvent, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import type { Order } from '../lib/types';
import { makeOrder, mockFetch, renderApp, seedAdminAuth } from '../test/utils';

const offlineOrder = (over: Partial<Order> = {}) =>
  makeOrder({
    status: 'in_atelier',
    channel: 'in_store',
    billType: 'gst_invoice',
    billNumber: 'GST-7',
    deliveryDueDate: '2026-08-20',
    notes: 'Blouse to be altered',
    advancePaid: 8400000,
    balance: 10000000,
    receipts: [
      {
        id: 'r1',
        orderId: 'o1',
        amount: 8400000,
        mode: 'cash',
        receivedAt: '2026-07-10',
        note: 'Advance',
        createdAt: '2026-07-10T10:00:00.000Z',
      },
    ],
    ...over,
  });

/** Only the documents call is expected on a state-seeded render. */
const noDocs = (url: string) => (url.endsWith('/api/admin/orders/o1/documents') ? { json: [] } : undefined);

describe('OrderDetail', () => {
  it('renders straight from navigation state without fetching the list', async () => {
    seedAdminAuth();
    const order = offlineOrder();
    const { calls } = mockFetch(noDocs);

    renderApp('/orders/o1', { order });

    expect(await screen.findByRole('heading', { name: 'TA-2026-04817' })).toBeInTheDocument();
    expect(screen.getByText('Emerald Court Gown')).toBeInTheDocument();
    expect(screen.getByText(/14 Altamount Road/)).toBeInTheDocument();
    expect(screen.getByText(/Bill GST-7/)).toBeInTheDocument();
    expect(screen.getByText(/Blouse to be altered/)).toBeInTheDocument();
    expect(screen.getByText(/2026-07-10 · Cash · Advance/)).toBeInTheDocument();

    const wa = screen.getByRole('link', { name: 'Send WhatsApp update' });
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919820000000\?text=/);

    expect(calls.some((c) => c.url.endsWith('/api/admin/orders'))).toBe(false);
  });

  it('falls back to the list fetch on a cold deep link', async () => {
    seedAdminAuth();
    const order = offlineOrder();
    const { calls } = mockFetch((url) => {
      if (url.endsWith('/api/admin/orders/o1/documents')) return { json: [] };
      if (url.endsWith('/api/admin/orders')) return { json: [makeOrder({ id: 'o9', orderNumber: 'TA-9' }), order] };
      return undefined;
    });

    renderApp('/orders/o1');

    expect(await screen.findByRole('heading', { name: 'TA-2026-04817' })).toBeInTheDocument();
    expect(calls.some((c) => c.url.endsWith('/api/admin/orders'))).toBe(true);
  });

  it('shows a way back when the order is not in the book', async () => {
    seedAdminAuth();
    mockFetch((url) => (url.endsWith('/api/admin/orders') ? { json: [] } : undefined));

    renderApp('/orders/o1');

    expect(await screen.findByText(/no longer in the book/)).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Back to orders' })).toBeInTheDocument();
  });

  it('records a payment in paise and refreshes the balance', async () => {
    seedAdminAuth();
    const order = offlineOrder();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/orders/o1/receipts') && init?.method === 'POST') {
        return {
          json: {
            ...order,
            advancePaid: 18400000,
            balance: 0,
            receipts: [
              ...order.receipts,
              {
                id: 'r2',
                orderId: 'o1',
                amount: 10000000,
                mode: 'online',
                receivedAt: '2026-07-24',
                note: '',
                createdAt: '2026-07-24T10:00:00.000Z',
              },
            ],
          },
        };
      }
      return noDocs(url);
    });

    renderApp('/orders/o1', { order });
    await screen.findByRole('heading', { name: 'TA-2026-04817' });

    const amount = screen.getByLabelText('Amount (₹)');
    expect(amount).toHaveAttribute('inputmode', 'decimal');
    await userEvent.type(amount, '100000');
    await userEvent.click(screen.getByRole('radio', { name: 'Online' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));

    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/orders/o1/receipts'));
    expect(post?.body).toEqual({ amount: 10000000, mode: 'online' });

    // balance row reflects the server's updated order, and the form is gone
    expect(await screen.findByText('₹0')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Record payment' })).not.toBeInTheDocument();
  });

  it('saves the delivery date only on Save — never on change', async () => {
    seedAdminAuth();
    const order = offlineOrder();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/orders/o1') && init?.method === 'PATCH') {
        return { json: { ...order, deliveryDueDate: '2026-09-15' } };
      }
      return noDocs(url);
    });

    renderApp('/orders/o1', { order });
    await screen.findByRole('heading', { name: 'TA-2026-04817' });

    const due = screen.getByLabelText('Delivery due');
    fireEvent.change(due, { target: { value: '2026-09-01' } });
    fireEvent.change(due, { target: { value: '2026-09-15' } });
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

    await userEvent.click(screen.getByRole('button', { name: 'Save date' }));

    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ deliveryDueDate: '2026-09-15' });
  });

  it('quick-sets the due date without touching the server', async () => {
    seedAdminAuth();
    const order = offlineOrder();
    const { calls } = mockFetch(noDocs);

    renderApp('/orders/o1', { order });
    await screen.findByRole('heading', { name: 'TA-2026-04817' });

    await userEvent.click(screen.getByRole('button', { name: '+7 days' }));

    const expected = new Date();
    expected.setDate(expected.getDate() + 7);
    const pad = (n: number) => String(n).padStart(2, '0');
    const iso = `${expected.getFullYear()}-${pad(expected.getMonth() + 1)}-${pad(expected.getDate())}`;

    expect(screen.getByLabelText('Delivery due')).toHaveValue(iso);
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
  });

  it('advances the status after the undo window and PATCHes once', async () => {
    seedAdminAuth();
    const order = offlineOrder();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/orders/o1') && init?.method === 'PATCH') {
        return { json: { ...order, status: 'quality_check' } };
      }
      return noDocs(url);
    });

    renderApp('/orders/o1', { order });
    await screen.findByRole('heading', { name: 'TA-2026-04817' });

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Move to Quality Check' }));

      // optimistic: the badge moves immediately, the server has not been told yet
      expect(screen.getByText('Quality Check', { selector: '.badge' })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Undo' })).toBeInTheDocument();
      expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

      await act(async () => {
        vi.advanceTimersByTime(5000);
      });

      const patches = calls.filter((c) => c.method === 'PATCH');
      expect(patches).toHaveLength(1);
      expect(patches[0].url).toMatch(/\/api\/admin\/orders\/o1$/);
      expect(patches[0].body).toEqual({ status: 'quality_check' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('Undo cancels the PATCH and puts the badge back', async () => {
    seedAdminAuth();
    const order = offlineOrder();
    const { calls } = mockFetch(noDocs);

    renderApp('/orders/o1', { order });
    await screen.findByRole('heading', { name: 'TA-2026-04817' });

    vi.useFakeTimers();
    try {
      fireEvent.click(screen.getByRole('button', { name: 'Move to Quality Check' }));
      expect(screen.getByText('Quality Check', { selector: '.badge' })).toBeInTheDocument();

      fireEvent.click(screen.getByRole('button', { name: 'Undo' }));
      expect(screen.getByText('In the Atelier', { selector: '.badge' })).toBeInTheDocument();

      await act(async () => {
        vi.advanceTimersByTime(30000);
      });
      expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);
    } finally {
      vi.useRealTimers();
    }
  });

  it('flushes a pending status change when the page unmounts', async () => {
    seedAdminAuth();
    const order = offlineOrder();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/orders/o1') && init?.method === 'PATCH') {
        return { json: { ...order, status: 'quality_check' } };
      }
      return noDocs(url);
    });

    const { unmount } = renderApp('/orders/o1', { order });
    await screen.findByRole('heading', { name: 'TA-2026-04817' });

    fireEvent.click(screen.getByRole('button', { name: 'Move to Quality Check' }));
    expect(calls.filter((c) => c.method === 'PATCH')).toHaveLength(0);

    unmount();

    const patches = calls.filter((c) => c.method === 'PATCH');
    expect(patches).toHaveLength(1);
    expect(patches[0].body).toEqual({ status: 'quality_check' });
  });

  it('cancels an order behind a confirm sheet', async () => {
    seedAdminAuth();
    const order = offlineOrder();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/orders/o1') && init?.method === 'PATCH') {
        return { json: { ...order, status: 'cancelled' } };
      }
      return noDocs(url);
    });

    renderApp('/orders/o1', { order });
    await screen.findByRole('heading', { name: 'TA-2026-04817' });

    await userEvent.click(screen.getByRole('button', { name: 'Cancel order' }));
    const sheet = await screen.findByRole('dialog', { name: 'Cancel this order?' });
    expect(sheet).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Yes, cancel it' }));

    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch?.body).toEqual({ status: 'cancelled' });
    expect(await screen.findByText('Cancelled', { selector: '.badge' })).toBeInTheDocument();
  });
});
