import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp } from '../test/utils';
import { AUTH_STORAGE_KEY } from '../lib/api';

describe('auth guard', () => {
  it('redirects unauthenticated visitors to the login screen', () => {
    mockFetch(() => undefined);
    renderApp('/');
    expect(screen.getByText('Atelier Portal')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Sign In' })).toBeInTheDocument();
    // no admin chrome rendered
    expect(screen.queryByRole('heading', { name: 'Dashboard' })).not.toBeInTheDocument();
  });

  it('rejects non-admin users with the staff message and stores nothing', async () => {
    mockFetch((url, init) => {
      if (url.endsWith('/api/auth/login') && init?.method === 'POST') {
        return {
          json: {
            token: 'customer-token',
            user: {
              id: 'u-cust',
              email: 'meera@example.in',
              firstName: 'Meera',
              lastName: 'Kapoor',
              role: 'customer',
            },
          },
        };
      }
      return undefined;
    });
    renderApp('/login');

    await userEvent.type(screen.getByLabelText('Email'), 'meera@example.in');
    await userEvent.type(screen.getByLabelText('Password'), 'secret123');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByText('This portal is for atelier staff')).toBeInTheDocument();
    expect(localStorage.getItem(AUTH_STORAGE_KEY)).toBeNull();
    // still on the login screen
    expect(screen.getByText('Atelier Portal')).toBeInTheDocument();
  });

  it('signs an admin in and lands on the dashboard', async () => {
    mockFetch((url, init) => {
      if (url.endsWith('/api/auth/login') && init?.method === 'POST') {
        return {
          json: {
            token: 'admin-token',
            user: {
              id: 'u-admin',
              email: 'atelier@tanviagnihotry.in',
              firstName: 'Tanvi',
              lastName: 'Agnihotry',
              role: 'admin',
            },
          },
        };
      }
      if (url.endsWith('/api/admin/summary')) {
        return {
          json: {
            activeOrders: 4,
            revenue: 0,
            pendingPayments: 0,
            lowStock: [],
            recentOrders: [],
          },
        };
      }
      return undefined;
    });
    renderApp('/login');

    await userEvent.type(screen.getByLabelText('Email'), 'atelier@tanviagnihotry.in');
    await userEvent.type(screen.getByLabelText('Password'), 'atelier-secret');
    await userEvent.click(screen.getByRole('button', { name: 'Sign In' }));

    expect(await screen.findByRole('heading', { name: 'Dashboard' })).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem(AUTH_STORAGE_KEY) ?? 'null');
    expect(stored?.token).toBe('admin-token');
    expect(stored?.user.role).toBe('admin');
  });
});
