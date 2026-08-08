import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';
import { AUTH_STORAGE_KEY } from '../lib/api';

const EMPTY_SUMMARY = {
  activeOrders: 0,
  revenue: 0,
  pendingPayments: 0,
  lowStock: [],
  recentOrders: [],
};

/** Every shell test lands on the dashboard first; nothing else fetches on mount. */
function stubApi() {
  return mockFetch((url) => {
    if (url.endsWith('/api/admin/summary')) return { json: EMPTY_SUMMARY };
    if (url.includes('/api/admin/customers/match')) return { json: { candidates: [] } };
    return undefined;
  });
}

/**
 * The phone app bar, scoped by class: pages render their own <header> section
 * heads, so `getByRole('banner')` is ambiguous on some routes.
 */
function appBar(): HTMLElement {
  const el = document.querySelector<HTMLElement>('.appbar');
  if (!el) throw new Error('no app bar rendered');
  return el;
}

/** The shell picks its chrome off `(max-width: 820px)`; jsdom's stub always says desktop. */
function stubPhoneViewport() {
  vi.stubGlobal(
    'matchMedia',
    (query: string) =>
      ({
        matches: query === '(max-width: 820px)',
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

describe('shell — desktop', () => {
  it('renders the grouped sidebar with the capture actions on top', async () => {
    seedAdminAuth();
    stubApi();

    renderApp('/');

    const sidebar = await screen.findByRole('navigation', { name: 'Admin' });

    // capture flows first
    expect(within(sidebar).getByRole('link', { name: 'New Order' })).toHaveAttribute(
      'href',
      '/orders/new',
    );
    expect(within(sidebar).getByRole('link', { name: 'Scan Bill' })).toHaveAttribute(
      'href',
      '/intake',
    );

    // then the grouped destinations
    for (const section of ['Overview', 'Sell', 'Catalog', 'People', 'Insights']) {
      expect(within(sidebar).getByText(section)).toBeInTheDocument();
    }
    expect(within(sidebar).getByRole('link', { name: 'Customers' })).toHaveAttribute(
      'href',
      '/users',
    );
    expect(within(sidebar).queryByRole('link', { name: 'Users' })).not.toBeInTheDocument();

    // no phone chrome on desktop
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });

  it('signs out from the sidebar', async () => {
    seedAdminAuth();
    stubApi();

    renderApp('/');
    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'Sign Out' }));

    expect(await screen.findByText('Atelier Portal')).toBeInTheDocument();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument();
  });
});

describe('shell — phone', () => {
  beforeEach(() => {
    stubPhoneViewport();
  });

  it('renders the tab bar instead of the sidebar', async () => {
    seedAdminAuth();
    stubApi();

    renderApp('/');

    const tabs = await screen.findByRole('navigation', { name: 'Primary' });
    expect(within(tabs).getByRole('link', { name: 'Home' })).toHaveAttribute('href', '/');
    expect(within(tabs).getByRole('link', { name: 'Orders' })).toHaveAttribute('href', '/orders');
    expect(within(tabs).getByRole('link', { name: 'Deliveries' })).toHaveAttribute(
      'href',
      '/deliveries',
    );
    expect(within(tabs).getByRole('button', { name: 'New order or scan bill' })).toBeInTheDocument();
    expect(within(tabs).getByRole('button', { name: 'More' })).toBeInTheDocument();

    expect(screen.queryByRole('navigation', { name: 'Admin' })).not.toBeInTheDocument();
  });

  it('shows the route title in the app bar', async () => {
    seedAdminAuth();
    stubApi();

    renderApp('/');

    // the app bar title sits alongside the page's own heading
    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument();
    expect(within(appBar()).getByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    expect(screen.getAllByRole('heading', { name: 'Dashboard' })).toHaveLength(2);
  });

  it('opens the capture sheet from ⊕ and navigates to Scan Bill', async () => {
    seedAdminAuth();
    stubApi();

    renderApp('/');
    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New order or scan bill' }));

    const sheet = screen.getByRole('dialog');
    expect(within(sheet).getByRole('heading', { name: 'Record a sale' })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /^Scan Bill/ })).toBeInTheDocument();
    expect(within(sheet).getByRole('button', { name: /^New Order/ })).toBeInTheDocument();

    await userEvent.click(within(sheet).getByRole('button', { name: /^Scan Bill/ }));

    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(within(appBar()).getByRole('heading', { name: 'Scan Bill' })).toBeInTheDocument();
  });

  it('navigates to New Order from the capture sheet', async () => {
    seedAdminAuth();
    stubApi();

    renderApp('/');
    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'New order or scan bill' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: /^New Order/ }),
    );

    expect(within(appBar()).getByRole('heading', { name: 'New Order' })).toBeInTheDocument();
    // detail routes get a back chevron
    expect(screen.getByRole('button', { name: 'Back' })).toBeInTheDocument();
  });

  it('lists the secondary destinations in the More sheet', async () => {
    seedAdminAuth();
    stubApi();

    renderApp('/');
    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'More' }));

    const sheet = screen.getByRole('dialog');
    for (const label of ['Products', 'Payments', 'Customers', 'Socials', 'Analytics']) {
      expect(within(sheet).getByRole('button', { name: label })).toBeInTheDocument();
    }
  });

  it('signs out from the More sheet', async () => {
    seedAdminAuth();
    stubApi();

    renderApp('/');
    expect(await screen.findByRole('navigation', { name: 'Primary' })).toBeInTheDocument();

    await userEvent.click(screen.getByRole('button', { name: 'More' }));
    await userEvent.click(
      within(screen.getByRole('dialog')).getByRole('button', { name: 'Sign Out' }),
    );

    expect(await screen.findByText('Atelier Portal')).toBeInTheDocument();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    expect(screen.queryByRole('navigation', { name: 'Primary' })).not.toBeInTheDocument();
  });
});
