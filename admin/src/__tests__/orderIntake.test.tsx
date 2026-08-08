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
    expect(screen.getByRole('group', { name: 'Order channel' })).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Bill type' })).toBeInTheDocument();
    expect(screen.getByLabelText('Bill Number')).toBeInTheDocument();
    expect(screen.getByLabelText('GST (₹ rupees)')).toBeInTheDocument(); // gst_invoice default
    expect(screen.getByLabelText('Description')).toBeInTheDocument();
    expect(screen.getByLabelText('Bill Total (₹ rupees)')).toBeInTheDocument();
    expect(screen.getByLabelText('Advance (₹ rupees)')).toBeInTheDocument();
    expect(screen.getByLabelText('Delivery Due Date')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '+14 days' })).toBeInTheDocument();
    expect(screen.getByLabelText('Notes')).toBeInTheDocument();
    expect(screen.getByRole('group', { name: 'Initial status' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Record Order' })).toBeInTheDocument();
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
    await userEvent.click(screen.getByRole('button', { name: 'Instagram' }));
    await userEvent.type(screen.getByLabelText('GST (₹ rupees)'), '7500');
    await userEvent.type(screen.getByLabelText('Bill Total (₹ rupees)'), '150000');
    await userEvent.type(screen.getByLabelText('Advance (₹ rupees)'), '50000');
    await userEvent.click(screen.getByRole('button', { name: 'Online' }));

    // computed balance: 1,50,000 − 50,000
    expect(screen.getByText('₹1,00,000')).toBeInTheDocument();

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

  it('captures address fields, flags a totals mismatch, and focuses submit errors', async () => {
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

    // chips expose pressed state to assistive tech
    const instagram = screen.getByRole('button', { name: 'Instagram' });
    expect(instagram).toHaveAttribute('aria-pressed', 'false');
    await userEvent.click(instagram);
    expect(instagram).toHaveAttribute('aria-pressed', 'true');

    // submitting an empty form focuses the error next to the actions
    await userEvent.click(screen.getByRole('button', { name: 'Record Order' }));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Add at least one item from the bill');
    expect(alert).toHaveFocus();

    // items sum ₹1,200 vs entered total ₹1,500 → non-blocking mismatch hint
    await userEvent.type(screen.getByLabelText('Description'), 'Sage stole');
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
    await userEvent.click(screen.getByRole('button', { name: 'Cash Memo' }));
    await userEvent.type(screen.getByLabelText('Bill Total (₹ rupees)'), '18000');
    await userEvent.click(screen.getByRole('button', { name: 'Delivered' }));
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
});
