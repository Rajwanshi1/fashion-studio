import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { PHONE_QUERY } from '../lib/useMediaQuery';
import { makeOrder, mockFetch, renderApp, seedAdminAuth } from '../test/utils';

const listCalls = (calls: { url: string; method: string }[]) =>
  calls.filter((c) => c.method === 'GET' && c.url.includes('/api/admin/orders'));

/** The jsdom stub reports desktop; this flips the shell into its phone layout. */
function stubPhoneViewport() {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query === PHONE_QUERY,
        media: query,
        onchange: null,
        addEventListener: () => {},
        removeEventListener: () => {},
        addListener: () => {},
        removeListener: () => {},
        dispatchEvent: () => false,
      }) as MediaQueryList,
  );
}

describe('Orders list', () => {
  it('renders the order rows', async () => {
    seedAdminAuth();
    const offline = makeOrder({
      status: 'in_atelier',
      channel: 'in_store',
      billType: 'gst_invoice',
      deliveryDueDate: '2026-08-20',
      balance: 10000000,
    });
    mockFetch((url) => (url.includes('/api/admin/orders') ? { json: [offline] } : undefined));

    renderApp('/orders');

    expect(await screen.findByText('TA-2026-04817')).toBeInTheDocument();
    expect(screen.getByText('Meera Kapoor')).toBeInTheDocument();
    expect(screen.getByText('₹1,84,000', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('In Store', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText('GST Invoice', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText('2026-08-20', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('₹1,00,000', { selector: 'td' })).toBeInTheDocument();
  });

  it('filters loaded rows client-side without refetching', async () => {
    seedAdminAuth();
    const meera = makeOrder();
    const anaya = makeOrder({
      id: 'o2',
      orderNumber: 'TA-2026-04999',
      firstName: 'Anaya',
      lastName: 'Rao',
      phone: '+91 90000 11111',
    });
    const { calls } = mockFetch((url) =>
      url.includes('/api/admin/orders') ? { json: [meera, anaya] } : undefined,
    );

    renderApp('/orders');
    await screen.findByText('TA-2026-04817');
    const before = listCalls(calls).length;

    const search = screen.getByLabelText('Search orders…');
    await userEvent.type(search, 'anaya');
    expect(screen.queryByText('TA-2026-04817')).not.toBeInTheDocument();
    expect(screen.getByText('TA-2026-04999')).toBeInTheDocument();

    // phone digits match past the formatting
    await userEvent.clear(search);
    await userEvent.type(search, '9820000');
    expect(screen.getByText('TA-2026-04817')).toBeInTheDocument();
    expect(screen.queryByText('TA-2026-04999')).not.toBeInTheDocument();

    // order number matches too
    await userEvent.clear(search);
    await userEvent.type(search, 'ta-2026-04999');
    expect(screen.getByText('TA-2026-04999')).toBeInTheDocument();

    // searching never hits the API
    expect(listCalls(calls).length).toBe(before);
  });

  it('drives the refetch query params from the filters sheet', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url) => (url.includes('/api/admin/orders') ? { json: [] } : undefined));

    renderApp('/orders');
    await screen.findByText('No orders in this state.');

    await userEvent.click(screen.getByRole('button', { name: 'Filters' }));
    const sheet = screen.getByRole('dialog', { name: 'Filters' });

    const status = within(sheet).getByRole('group', { name: 'Filter by status' });
    await userEvent.click(within(status).getByRole('button', { name: 'Dispatched' }));
    await screen.findByText('No orders in this state.');
    expect(calls.some((c) => c.url.endsWith('/api/admin/orders?status=dispatched'))).toBe(true);

    const channel = within(sheet).getByRole('group', { name: 'Filter by channel' });
    await userEvent.click(within(channel).getByRole('button', { name: 'In Store' }));
    const bill = within(sheet).getByRole('group', { name: 'Filter by bill type' });
    await userEvent.click(within(bill).getByRole('button', { name: 'Cash Memo' }));

    await screen.findByText('No orders in this state.');
    expect(
      calls.some((c) =>
        c.url.endsWith('/api/admin/orders?status=dispatched&channel=in_store&billType=cash_memo'),
      ),
    ).toBe(true);

    // the trigger counts the active filters, and Done dismisses the sheet
    await userEvent.click(within(sheet).getByRole('button', { name: 'Done' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Filters · 3' })).toBeInTheDocument();
  });

  it('opens the detail page on row click, carrying the order in navigation state', async () => {
    seedAdminAuth();
    const order = makeOrder();
    const { calls } = mockFetch((url) => {
      if (url.endsWith('/api/admin/orders/o1/documents')) return { json: [] };
      if (url.includes('/api/admin/orders')) return { json: [order] };
      return undefined;
    });

    renderApp('/orders');
    await userEvent.click(await screen.findByText('TA-2026-04817'));

    // detail page header, rendered from state — the list is not refetched
    expect(await screen.findByRole('heading', { name: 'TA-2026-04817' })).toBeInTheDocument();
    expect(screen.getByText('Emerald Court Gown')).toBeInTheDocument();
    expect(listCalls(calls).filter((c) => c.url.endsWith('/api/admin/orders')).length).toBe(1);
  });

  it('renders tappable cards instead of the table on a phone', async () => {
    seedAdminAuth();
    stubPhoneViewport();
    const order = makeOrder({ deliveryDueDate: '2026-08-20' });
    mockFetch((url) => {
      if (url.endsWith('/api/admin/orders/o1/documents')) return { json: [] };
      if (url.includes('/api/admin/orders')) return { json: [order] };
      return undefined;
    });

    renderApp('/orders');

    const card = await screen.findByRole('button', { name: 'Open order TA-2026-04817' });
    expect(within(card).getByText('Meera Kapoor')).toBeInTheDocument();
    expect(within(card).getByText('TA-2026-04817 · due 20 Aug 2026')).toBeInTheDocument();
    expect(within(card).getByText('₹1,84,000')).toBeInTheDocument();
    expect(screen.queryByRole('table')).not.toBeInTheDocument();

    await userEvent.click(card);
    // Detail page opens; usePageTitle puts the order number in the phone app bar too.
    expect(await screen.findAllByRole('heading', { name: 'TA-2026-04817' })).toHaveLength(2);
    expect(document.querySelector('.appbar-title')).toHaveTextContent('TA-2026-04817');
  });

  it('redirects the legacy ?focus= deep link to the order page', async () => {
    seedAdminAuth();
    const order = makeOrder();
    mockFetch((url) => {
      if (url.endsWith('/api/admin/orders/o1/documents')) return { json: [] };
      if (url.includes('/api/admin/orders')) return { json: [order] };
      return undefined;
    });

    renderApp('/orders?focus=o1');

    expect(await screen.findByRole('heading', { name: 'TA-2026-04817' })).toBeInTheDocument();
  });
});
