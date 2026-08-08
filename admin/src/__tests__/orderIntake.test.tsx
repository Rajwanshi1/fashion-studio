import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeOrder, mockFetch, renderApp, seedAdminAuth } from '../test/utils';

const CANDIDATE = {
  id: 'u9',
  email: 'meera@example.com',
  phone: '+919820011223',
  firstName: 'Meera',
  lastName: 'Kapoor',
  role: 'customer',
  authProvider: 'otp',
  createdAt: '2026-06-01T10:00:00.000Z',
  ordersCount: 2,
};

describe('OrderIntake', () => {
  it('renders every section of the intake form', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.includes('/api/admin/customers/match')) return { json: { candidates: [] } };
      return undefined;
    });

    renderApp('/orders/new');

    expect(await screen.findByRole('heading', { name: 'New Order' })).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toBeInTheDocument();
    // single-choice groups are segmented controls (radiogroups), not chips
    expect(screen.getByRole('radiogroup', { name: 'Channel' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Bill type' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Advance mode' })).toBeInTheDocument();
    expect(screen.getByRole('radiogroup', { name: 'Order status' })).toBeInTheDocument();
    expect(screen.getByLabelText('Bill Number')).toBeInTheDocument();
    expect(screen.getByLabelText('GST (₹ rupees)')).toBeInTheDocument(); // gst_invoice default
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    // qty is a stepper: −/+ buttons around the input
    expect(screen.getByLabelText('Qty')).toHaveValue('1');
    expect(screen.getByRole('button', { name: 'Increase quantity' })).toBeInTheDocument();
    expect(screen.getByLabelText('Bill Total (₹ rupees)')).toBeInTheDocument();
    expect(screen.getByLabelText('Advance (₹ rupees)')).toBeInTheDocument();
    expect(screen.getByLabelText('Delivery Due Date')).toBeInTheDocument();
    // the quick due-date chips stay chips — they are actions, not a selection
    expect(screen.getByRole('button', { name: '+14 days' })).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
    // sticky bar: running totals beside the actions
    expect(screen.getByText('Total ₹0')).toBeInTheDocument();
    expect(screen.getByText('Balance ₹0')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record Order' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Cancel' })).toBeInTheDocument();
  });

  it('computes the balance and POSTs rupee inputs converted to paise', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.includes('/api/admin/customers/match')) return { json: { candidates: [] } };
      if (url.endsWith('/api/admin/orders') && init?.method === 'POST') {
        return { status: 201, json: makeOrder({ orderNumber: 'TA-2026-04901' }) };
      }
      if (url.endsWith('/api/admin/orders')) return { json: [] };
      return undefined;
    });

    renderApp('/orders/new');
    await screen.findByRole('heading', { name: 'New Order' });

    await userEvent.type(screen.getByLabelText('First Name'), 'Rhea');
    await userEvent.type(screen.getByLabelText('Phone'), '98200 11223');
    await userEvent.type(screen.getByLabelText('Description'), 'Custom lehenga, bridal fit');
    await userEvent.type(screen.getByLabelText('Unit ₹'), '120000');
    await userEvent.click(screen.getByRole('radio', { name: 'Instagram' }));
    await userEvent.type(screen.getByLabelText('GST (₹ rupees)'), '7500');
    await userEvent.type(screen.getByLabelText('Bill Total (₹ rupees)'), '150000');
    await userEvent.type(screen.getByLabelText('Advance (₹ rupees)'), '50000');
    await userEvent.click(screen.getByRole('radio', { name: 'Online' }));

    // running totals in the sticky bar: 1,50,000 and 1,50,000 − 50,000
    expect(screen.getByText('Total ₹1,50,000')).toBeInTheDocument();
    expect(screen.getByText('Balance ₹1,00,000')).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Record Order' }));

    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/admin/orders'));
    expect(post).toBeDefined();
    expect(post?.body).toEqual({
      channel: 'instagram',
      billType: 'gst_invoice',
      customer: { action: 'create', firstName: 'Rhea', phone: '98200 11223' },
      items: [{ description: 'Custom lehenga, bridal fit', quantity: 1, unitPrice: 12000000 }],
      gstAmount: 750000,
      total: 15000000,
      advance: { amount: 5000000, mode: 'online' },
      initialStatus: 'in_atelier',
    });

    // success → toast + back to the order book
    expect(await screen.findByRole('heading', { name: 'Orders' })).toBeInTheDocument();
  });

  it('steps the item quantity without the keyboard', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.includes('/api/admin/customers/match')) return { json: { candidates: [] } };
      if (url.endsWith('/api/admin/orders') && init?.method === 'POST') {
        return { status: 201, json: makeOrder({ orderNumber: 'TA-2026-04905' }) };
      }
      if (url.endsWith('/api/admin/orders')) return { json: [] };
      return undefined;
    });

    renderApp('/orders/new');
    await screen.findByRole('heading', { name: 'New Order' });

    // min is 1 — the − button is disabled at the floor
    expect(screen.getByRole('button', { name: 'Decrease quantity' })).toBeDisabled();
    await userEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    await userEvent.click(screen.getByRole('button', { name: 'Increase quantity' }));
    expect(screen.getByLabelText('Qty')).toHaveValue('3');
    await userEvent.click(screen.getByRole('button', { name: 'Decrease quantity' }));
    expect(screen.getByLabelText('Qty')).toHaveValue('2');

    await userEvent.type(screen.getByLabelText('First Name'), 'Rhea');
    await userEvent.type(screen.getByLabelText('Phone'), '98200 11223');
    await userEvent.type(screen.getByLabelText('Description'), 'Silk stole');
    await userEvent.type(screen.getByLabelText('Unit ₹'), '4000');
    await userEvent.click(screen.getByRole('button', { name: 'Record Order' }));

    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/admin/orders'));
    // no bill total typed → the items sum stands in, ×2
    expect(post?.body).toMatchObject({
      items: [{ description: 'Silk stole', quantity: 2, unitPrice: 400000 }],
      total: 800000,
    });
  });

  it('captures address fields, flags a totals mismatch, and shows per-field errors', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.includes('/api/admin/customers/match')) return { json: { candidates: [] } };
      if (url.endsWith('/api/admin/orders') && init?.method === 'POST') {
        return { status: 201, json: makeOrder({ orderNumber: 'TA-2026-04904' }) };
      }
      if (url.endsWith('/api/admin/orders')) return { json: [] };
      return undefined;
    });

    renderApp('/orders/new');
    await screen.findByRole('heading', { name: 'New Order' });

    // the new address inputs render
    expect(screen.getByLabelText('Address (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('Address Line 2 (optional)')).toBeInTheDocument();
    expect(screen.getByLabelText('State (optional)')).toBeInTheDocument();

    // segmented options expose checked state to assistive tech
    const instagram = screen.getByRole('radio', { name: 'Instagram' });
    expect(instagram).toHaveAttribute('aria-checked', 'false');
    await userEvent.click(instagram);
    expect(instagram).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'In Store' })).toHaveAttribute('aria-checked', 'false');

    // submitting an empty form errors every missing field inline …
    await userEvent.click(screen.getByRole('button', { name: 'Record Order' }));
    expect(await screen.findByText('Enter a valid mobile number')).toBeInTheDocument();
    expect(screen.getByText('Customer first name is required')).toBeInTheDocument();
    expect(screen.getByText('Add at least one item from the bill')).toBeInTheDocument();
    expect(screen.getByText('Please enter the bill total in rupees')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toHaveAttribute('aria-invalid', 'true');

    // … and summarises them in the sticky bar, focus parked on the first one
    const summary = screen.getByRole('button', { name: '4 fields need attention' });
    expect(summary).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toHaveFocus();

    // typing in a field clears its own error straight away
    await userEvent.type(screen.getByLabelText('Description'), 'Sage stole');
    expect(screen.queryByText('Add at least one item from the bill')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: '3 fields need attention' })).toBeInTheDocument();

    // items sum ₹1,200 vs entered total ₹1,500 → non-blocking mismatch hint
    await userEvent.type(screen.getByLabelText('Unit ₹'), '1200');
    await userEvent.type(screen.getByLabelText('Bill Total (₹ rupees)'), '1500');
    expect(screen.getByText(/check item prices or GST/)).toBeInTheDocument();

    // a matching total clears the hint
    await userEvent.clear(screen.getByLabelText('Bill Total (₹ rupees)'));
    await userEvent.type(screen.getByLabelText('Bill Total (₹ rupees)'), '1200');
    expect(screen.queryByText(/check item prices or GST/)).not.toBeInTheDocument();

    // typed address fields land in the create-customer payload
    await userEvent.type(screen.getByLabelText('First Name'), 'Rhea');
    await userEvent.type(screen.getByLabelText('Phone'), '98200 11223');
    await userEvent.type(screen.getByLabelText('Address (optional)'), '12 Marine Drive');
    await userEvent.type(screen.getByLabelText('State (optional)'), 'Maharashtra');
    expect(screen.queryByRole('button', { name: /fields need attention/ })).not.toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Record Order' }));

    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/admin/orders'));
    expect(post?.body).toMatchObject({
      customer: {
        action: 'create',
        firstName: 'Rhea',
        addressLine1: '12 Marine Drive',
        state: 'Maharashtra',
      },
    });
  });

  it('blocks an advance larger than the total', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url) => {
      if (url.includes('/api/admin/customers/match')) return { json: { candidates: [] } };
      return undefined;
    });

    renderApp('/orders/new');
    await screen.findByRole('heading', { name: 'New Order' });

    await userEvent.type(screen.getByLabelText('First Name'), 'Rhea');
    await userEvent.type(screen.getByLabelText('Phone'), '98200 11223');
    await userEvent.type(screen.getByLabelText('Description'), 'Sage stole');
    await userEvent.type(screen.getByLabelText('Unit ₹'), '1200');
    await userEvent.type(screen.getByLabelText('Advance (₹ rupees)'), '5000');
    await userEvent.click(screen.getByRole('button', { name: 'Record Order' }));

    // inline on the field, and — being the only error — verbatim in the sticky summary
    expect(
      await screen.findByRole('button', { name: 'Advance cannot exceed the total' }),
    ).toBeInTheDocument();
    expect(screen.getByLabelText('Advance (₹ rupees)')).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByLabelText('Advance (₹ rupees)')).toHaveAccessibleDescription(
      'Advance cannot exceed the total',
    );
    expect(calls.some((c) => c.method === 'POST')).toBe(false);
  });

  it('links a matched customer instead of creating one', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.includes('/api/admin/customers/match')) return { json: { candidates: [CANDIDATE] } };
      if (url.endsWith('/api/admin/orders') && init?.method === 'POST') {
        return { status: 201, json: makeOrder({ orderNumber: 'TA-2026-04902' }) };
      }
      if (url.endsWith('/api/admin/orders')) return { json: [] };
      return undefined;
    });

    renderApp('/orders/new');
    await screen.findByRole('heading', { name: 'New Order' });

    await userEvent.type(screen.getByLabelText('Phone'), '98200 11223');
    // debounced match → candidate card appears
    expect(await screen.findByText('Meera Kapoor')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Link' }));
    // linked card replaces the new-customer fields
    expect(screen.queryByLabelText('First Name')).not.toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Description'), 'Sage stole');
    await userEvent.type(screen.getByLabelText('Unit ₹'), '18000');
    await userEvent.click(screen.getByRole('radio', { name: 'Cash Memo' }));
    await userEvent.type(screen.getByLabelText('Bill Total (₹ rupees)'), '18000');
    await userEvent.click(screen.getByRole('radio', { name: 'Delivered' }));
    await userEvent.click(screen.getByRole('button', { name: 'Record Order' }));

    const post = calls.find((c) => c.method === 'POST' && c.url.endsWith('/api/admin/orders'));
    expect(post?.body).toMatchObject({
      billType: 'cash_memo',
      customer: { action: 'link', userId: 'u9' },
      items: [{ description: 'Sage stole', quantity: 1, unitPrice: 1800000 }],
      total: 1800000,
      initialStatus: 'delivered',
    });
    expect((post?.body as Record<string, unknown>).advance).toBeUndefined();
    expect((post?.body as Record<string, unknown>).gstAmount).toBeUndefined();
  });

  it('offers the atelier measurement names as autocomplete', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.includes('/api/admin/customers/match')) return { json: { candidates: [] } };
      return undefined;
    });

    renderApp('/orders/new');
    await screen.findByRole('heading', { name: 'New Order' });

    await userEvent.click(screen.getByRole('button', { name: '+ Add Measurement Set' }));
    const name = screen.getByLabelText('Measurement 1 name');
    const listId = name.getAttribute('list');
    expect(listId).toBe('ms-0-names');

    // one shared datalist per set, carrying every suggestion
    const lists = document.querySelectorAll(`datalist#${listId}`);
    expect(lists).toHaveLength(1);
    const values = Array.from(lists[0].querySelectorAll('option')).map((o) => o.value);
    expect(values).toContain('Shoulder');
    expect(values).toContain('Blouse Length');

    // a second row reuses the same list
    await userEvent.click(screen.getByRole('button', { name: '+ Add measurement' }));
    expect(screen.getByLabelText('Measurement 2 name')).toHaveAttribute('list', listId);
  });
});
