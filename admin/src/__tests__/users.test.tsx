import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { ADMIN_AUTH, mockFetch, renderApp, seedAdminAuth } from '../test/utils';
import type { AdminUser } from '../lib/types';

const ME: AdminUser = {
  ...ADMIN_AUTH.user,
  authProvider: 'password',
  createdAt: '2026-01-05T10:00:00.000Z',
  ordersCount: 0,
};

const CUSTOMER: AdminUser = {
  id: 'u2',
  email: 'meera@example.in',
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
  firstName: '',
  lastName: '',
  role: 'customer',
  authProvider: 'password',
  createdAt: '2026-07-01T10:00:00.000Z',
  ordersCount: 1,
};

describe('Users', () => {
  it('renders the users table from the API', async () => {
    seedAdminAuth();
    mockFetch((url, init) => {
      if (url.endsWith('/api/admin/users') && (init?.method ?? 'GET') === 'GET') {
        return { json: [GUEST, CUSTOMER, ME] };
      }
      return undefined;
    });

    renderApp('/users');

    expect(await screen.findByRole('heading', { name: 'Users' })).toBeInTheDocument();
    expect(screen.getByText('The House · Access')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Users' })).toBeInTheDocument();

    // names — em-dash when the user has no name
    expect(screen.getByText('Meera Kapoor')).toBeInTheDocument();
    expect(screen.getByText('Tanvi Agnihotry', { selector: 'td .nm' })).toBeInTheDocument();
    expect(screen.getByText('—', { selector: 'td .dim' })).toBeInTheDocument();

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
