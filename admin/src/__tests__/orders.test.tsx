import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeOrder, mockFetch, renderApp, seedAdminAuth } from '../test/utils';

describe('Orders', () => {
  it('expands a row and PATCHes the selected valid transition', async () => {
    seedAdminAuth();
    const order = makeOrder({ status: 'paid' });
    order.items[0].measurements = 'bust 36in, waist 30in';
    order.items[0].components = [
      { name: 'dupatta', price: 0 },
      { name: 'jacket', price: 1200000 },
    ];
    order.items[0].customColor = true;
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/orders') && (init?.method ?? 'GET') === 'GET') {
        return { json: [order] };
      }
      if (url.endsWith('/api/admin/orders/o1') && init?.method === 'PATCH') {
        return { json: { ...order, status: 'in_atelier' } };
      }
      return undefined;
    });

    renderApp('/orders');

    // row renders
    const cell = await screen.findByText('TA-2026-04817');
    expect(screen.getByText('Meera Kapoor')).toBeInTheDocument();
    expect(screen.getByText('₹1,84,000', { selector: 'td' })).toBeInTheDocument();

    // expand → detail pane with items (incl. the measurements note) + address + status select
    await userEvent.click(cell);
    expect(screen.getByText('Emerald Court Gown')).toBeInTheDocument();
    // kept add-ons render by name from the order-time snapshot; the custom
    // colour request is disclosed on the same line
    expect(screen.getByText(/· with dupatta & jacket · custom colour \(\+₹1,000\)/)).toBeInTheDocument();
    expect(screen.getByText('bust 36in, waist 30in')).toBeInTheDocument();
    expect(screen.getByText(/14 Altamount Road/)).toBeInTheDocument();

    const select = screen.getByLabelText('Status');
    const options = Array.from(select.querySelectorAll('option')).map((o) =>
      o.getAttribute('value'),
    );
    // paid → only in_atelier | cancelled offered (plus disabled current)
    expect(options).toEqual(['paid', 'in_atelier', 'cancelled']);

    await userEvent.selectOptions(select, 'in_atelier');

    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(patch?.url).toMatch(/\/api\/admin\/orders\/o1$/);
    expect(patch?.body).toEqual({ status: 'in_atelier' });

    // status pill updates in the table
    expect(await screen.findByText('In the Atelier', { selector: '.badge' })).toBeInTheDocument();
  });

  it('shows the first-order discount row between items and delivery', async () => {
    seedAdminAuth();
    const order = makeOrder({
      discountAmount: 920000,
      discountReason: 'first_order_5pct',
      total: 17480000,
    });
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/orders') && (init?.method ?? 'GET') === 'GET') {
        return { json: [order] };
      }
      return undefined;
    });

    renderApp('/orders');
    await userEvent.click(await screen.findByText('TA-2026-04817'));

    const rows = Array.from(document.querySelectorAll('.odetail .oitem')).map(
      (el) => el.textContent ?? '',
    );
    expect(rows).toHaveLength(3); // item · discount · delivery
    expect(rows[1]).toContain('First order − 5%');
    expect(rows[1]).toContain('−₹9,200');
    expect(rows[2]).toContain('Delivery');
  });

  it('filters orders via status chips', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url) => {
      if (url.includes('/api/admin/orders')) return { json: [] };
      return undefined;
    });

    renderApp('/orders');
    await screen.findByText(/No orders yet\./);

    await userEvent.click(screen.getByRole('button', { name: 'Dispatched' }));
    // Empty states name the actual filter and offer a way in.
    await screen.findByText(/No dispatched orders\./);
    expect(screen.getByRole('link', { name: 'Record an order' })).toBeInTheDocument();

    expect(calls.some((c) => c.url.endsWith('/api/admin/orders?status=dispatched'))).toBe(true);
  });

  it('combines channel and bill-type chips into the query string', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url) => {
      if (url.includes('/api/admin/orders')) return { json: [] };
      return undefined;
    });

    renderApp('/orders');
    await screen.findByText(/No orders yet\./);

    await userEvent.click(screen.getByRole('button', { name: 'In Store' }));
    await screen.findByText(/No orders yet\./);
    expect(calls.some((c) => c.url.endsWith('/api/admin/orders?channel=in_store'))).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Cash Memo' }));
    await screen.findByText(/No orders yet\./);
    expect(
      calls.some((c) => c.url.endsWith('/api/admin/orders?channel=in_store&billType=cash_memo')),
    ).toBe(true);

    await userEvent.click(screen.getByRole('button', { name: 'Dispatched' }));
    await screen.findByText(/No dispatched orders\./);
    expect(
      calls.some((c) =>
        c.url.endsWith('/api/admin/orders?status=dispatched&channel=in_store&billType=cash_memo'),
      ),
    ).toBe(true);
  });

  it('shows offline badges, due date and balance; records a payment in paise', async () => {
    seedAdminAuth();
    const offline = makeOrder({
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
      items: [
        {
          id: 'oi1',
          productId: null,
          variantId: null,
          productName: 'Custom sage lehenga',
          size: '',
          color: '',
          unitPrice: 18400000,
          quantity: 1,
          components: [],
          customColor: false,
          imageUrl: null,
          measurements: '',
        },
      ],
    });
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/orders/o1/receipts') && init?.method === 'POST') {
        return {
          json: {
            ...offline,
            advancePaid: 18400000,
            balance: 0,
            receipts: [
              ...offline.receipts,
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
      if (url.includes('/api/admin/orders')) return { json: [offline] };
      return undefined;
    });

    renderApp('/orders');
    const cell = await screen.findByText('TA-2026-04817');

    // badges + new columns
    expect(screen.getByText('In Store', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText('GST Invoice', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText('2026-08-20', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('₹1,00,000', { selector: 'td' })).toBeInTheDocument();

    // expanded row: bill, notes, receipts, whatsapp link, tel link
    await userEvent.click(cell);
    expect(screen.getByText(/Bill GST-7/)).toBeInTheDocument();
    expect(screen.getByText(/Blouse to be altered/)).toBeInTheDocument();
    // Receipt dates render like every other date in the app, not raw ISO.
    expect(screen.getByText(/10 Jul 2026 · Cash · Advance/)).toBeInTheDocument();
    const wa = screen.getByRole('link', { name: 'Send WhatsApp update' });
    expect(wa.getAttribute('href')).toMatch(/^https:\/\/wa\.me\/919820000000\?text=/);
    expect(wa.getAttribute('href')).toContain(encodeURIComponent('TA-2026-04817'));
    expect(screen.getByRole('link', { name: '+91 98200 00000' }).getAttribute('href')).toBe(
      'tel:+91 98200 00000',
    );

    // offline machine: in_atelier → quality_check | cancelled
    const select = screen.getByLabelText('Status');
    const options = Array.from(select.querySelectorAll('option')).map((o) => o.getAttribute('value'));
    expect(options).toEqual(['in_atelier', 'quality_check', 'cancelled']);

    // record a payment — rupees in, paise out
    await userEvent.type(screen.getByLabelText('Amount (₹)'), '100000');
    await userEvent.selectOptions(screen.getByLabelText('Mode'), 'online');
    await userEvent.click(screen.getByRole('button', { name: 'Record payment' }));

    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/orders/o1/receipts'));
    expect(post?.body).toEqual({ amount: 10000000, mode: 'online' });

    // refreshed order lands in the table — balance cleared
    expect(await screen.findByText('—', { selector: 'td.num' })).toBeInTheDocument();
  });

  it('sends the invoice on WhatsApp from the expanded row and shows the sent state', async () => {
    seedAdminAuth();
    const order = makeOrder({ status: 'in_atelier', channel: 'in_store', billType: 'cash_memo' });
    const sentAt = '2026-08-10T10:00:00.000Z';
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/orders') && (init?.method ?? 'GET') === 'GET') {
        return { json: [order] };
      }
      if (url.endsWith('/api/admin/orders/o1/invoice/send') && init?.method === 'POST') {
        return { json: { ...order, invoiceSentAt: sentAt } };
      }
      return undefined;
    });

    renderApp('/orders');
    await userEvent.click(await screen.findByText('TA-2026-04817'));

    expect(screen.getByRole('button', { name: 'Invoice PDF' })).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Send invoice on WhatsApp' }));

    // the returned order replaces the row: re-send label + sent note
    expect(await screen.findByRole('button', { name: 'Re-send invoice on WhatsApp' })).toBeInTheDocument();
    expect(screen.getByText(/Invoice sent/, { selector: 'p' })).toBeInTheDocument();
    expect(calls.some((c) => c.method === 'POST' && c.url.endsWith('/orders/o1/invoice/send'))).toBe(true);
  });

  it('disables the invoice send for orders without a phone', async () => {
    seedAdminAuth();
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/orders') && (init?.method ?? 'GET') === 'GET') {
        return { json: [makeOrder({ phone: '' })] };
      }
      return undefined;
    });

    renderApp('/orders');
    await userEvent.click(await screen.findByText('TA-2026-04817'));

    expect(screen.getByRole('button', { name: 'Send invoice on WhatsApp' })).toBeDisabled();
  });
});
