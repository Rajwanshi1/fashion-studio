import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_AUTH, mockFetch, renderApp, seedAdminAuth } from '../test/utils';
import type { AdminUser } from '../lib/types';

const ME: AdminUser = {
  ...ADMIN_AUTH.user,
  phone: null,
  authProvider: 'password',
  createdAt: '2026-01-05T10:00:00.000Z',
  ordersCount: 0,
};

const CUSTOMER: AdminUser = {
  id: 'u2',
  email: 'meera@example.in',
  phone: '+919876543210',
  firstName: 'Meera',
  lastName: 'Kapoor',
  role: 'customer',
  authProvider: 'google',
  createdAt: '2026-06-20T10:00:00.000Z',
  ordersCount: 3,
};

const GUEST: AdminUser = {
  id: 'u3',
  email: 'guest@example.in',
  phone: null,
  firstName: '',
  lastName: '',
  role: 'customer',
  authProvider: 'password',
  createdAt: '2026-07-01T10:00:00.000Z',
  ordersCount: 1,
};

describe('Customers', () => {
  it('renders the customers table from the API', async () => {
    seedAdminAuth();
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/users') && (init?.method ?? 'GET') === 'GET') {
        return { json: [GUEST, CUSTOMER, ME] };
      }
      return undefined;
    });

    renderApp('/users');

    // a skeleton stands in until the list lands
    expect(screen.getByRole('status', { name: 'Loading' })).toBeInTheDocument();

    expect(await screen.findByRole('heading', { name: 'Customers' })).toBeInTheDocument();
    expect(screen.getByText('The House · Customers')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Customers' })).toBeInTheDocument();
    expect(screen.queryByRole('status', { name: 'Loading' })).not.toBeInTheDocument();

    // names — em-dash when the user has no name
    expect(screen.getByText('Meera Kapoor')).toBeInTheDocument();
    expect(screen.getByText('Tanvi Agnihotry', { selector: 'td .nm' })).toBeInTheDocument();
    // one for the guest's missing name, one each for ME/GUEST's missing phone
    expect(screen.getAllByText('—', { selector: 'td .dim' })).toHaveLength(3);
    expect(screen.getByText('+919876543210')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Export contacts (.vcf)' })).toBeInTheDocument();

    // emails, provider badges, role pills
    expect(screen.getByText('meera@example.in')).toBeInTheDocument();
    expect(screen.getAllByText('password', { selector: '.badge' })).toHaveLength(2);
    expect(screen.getByText('google', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getByText('Admin', { selector: '.badge' })).toBeInTheDocument();
    expect(screen.getAllByText('Customer', { selector: '.badge' })).toHaveLength(2);

    // orders count + joined date
    expect(screen.getByText('3', { selector: 'td' })).toBeInTheDocument();
    expect(screen.getByText('20 Jun 2026')).toBeInTheDocument();
  });

  it('filters the loaded list by name, email or phone digits', async () => {
    seedAdminAuth();
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/users') && (init?.method ?? 'GET') === 'GET') {
        return { json: [GUEST, CUSTOMER, ME] };
      }
      return undefined;
    });

    renderApp('/users');
    await screen.findByText('Meera Kapoor');

    const search = screen.getByRole('searchbox', { name: 'Search customers…' });

    // name, case-insensitively
    await userEvent.type(search, 'MEERA');
    expect(screen.getByText('Meera Kapoor')).toBeInTheDocument();
    expect(screen.queryByText('guest@example.in')).not.toBeInTheDocument();

    // email
    await userEvent.clear(search);
    await userEvent.type(search, 'guest@');
    expect(screen.getByText('guest@example.in')).toBeInTheDocument();
    expect(screen.queryByText('Meera Kapoor')).not.toBeInTheDocument();

    // phone, however the typed number is punctuated
    await userEvent.clear(search);
    await userEvent.type(search, '+91 98765');
    expect(screen.getByText('+919876543210')).toBeInTheDocument();
    expect(screen.queryByText('guest@example.in')).not.toBeInTheDocument();

    // nothing matches → the search-specific empty message, not the no-customers one
    await userEvent.clear(search);
    await userEvent.type(search, 'zzz');
    expect(screen.getByText('No customers match that search.')).toBeInTheDocument();
  });

  it('PATCHes the role change and shows the success toast', async () => {
    seedAdminAuth();
    const { calls } = mockFetch((url, init) => {
      if (url.endsWith('/api/admin/users') && (init?.method ?? 'GET') === 'GET') {
        return { json: [CUSTOMER, ME] };
      }
      if (url.endsWith('/api/admin/users/u2') && init?.method === 'PATCH') {
        return { json: { ...CUSTOMER, role: 'admin' } };
      }
      return undefined;
    });

    renderApp('/users');
    await screen.findByText('Meera Kapoor');

    await userEvent.click(screen.getByRole('button', { name: 'Make admin' }));

    const patch = calls.find((c) => c.method === 'PATCH');
    expect(patch).toBeDefined();
    expect(patch?.url).toMatch(/\/api\/admin\/users\/u2$/);
    expect(patch?.body).toEqual({ role: 'admin' });

    // pill refreshes and the toast confirms
    expect(await screen.findAllByText('Admin', { selector: '.badge' })).toHaveLength(2);
    expect(screen.getByText('meera@example.in is now an admin')).toBeInTheDocument();
  });

  it('disables the action on the signed-in admin’s own row', async () => {
    seedAdminAuth();
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/users') && (init?.method ?? 'GET') === 'GET') {
        return { json: [CUSTOMER, ME] };
      }
      return undefined;
    });

    renderApp('/users');
    await screen.findByText('Meera Kapoor');

    // ME is an admin → own row offers 'Make customer', but disabled with the title
    const own = screen.getByRole('button', { name: 'Make customer' });
    expect(own).toBeDisabled();
    expect(own).toHaveAttribute('title', 'You cannot change your own role');

    // the other row's action stays enabled
    expect(screen.getByRole('button', { name: 'Make admin' })).toBeEnabled();
  });
});
