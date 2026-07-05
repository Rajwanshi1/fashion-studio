import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { makeOrder, mockFetch, renderApp, seedAdminAuth } from '../test/utils';

describe('Orders', () => {
  it('expands a row and PATCHes the selected valid transition', async () => {
    seedAdminAuth();
    const order = makeOrder({ status: 'paid' });
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

    // expand → detail pane with items + address + status select
    await userEvent.click(cell);
    expect(screen.getByText('Emerald Court Gown')).toBeInTheDocument();
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

  it('filters orders via status chips', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url) => {
      if (url.includes('/api/admin/orders')) return { json: [] };
      return undefined;
    });

    renderApp('/orders');
    await screen.findByText('No orders in this state.');

    await userEvent.click(screen.getByRole('button', { name: 'Dispatched' }));
    await screen.findByText('No orders in this state.');

    expect(calls.some((c) => c.url.endsWith('/api/admin/orders?status=dispatched'))).toBe(true);
  });
});
