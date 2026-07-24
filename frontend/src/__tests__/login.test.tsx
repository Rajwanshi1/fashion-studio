import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp } from './helpers';

const GSI_SRC = 'https://accounts.google.com/gsi/client';

afterEach(() => {
  vi.unstubAllEnvs();
  vi.unstubAllGlobals();
  document.querySelectorAll(`script[src="${GSI_SRC}"]`).forEach((s) => s.remove());
});

describe('Login — phone OTP', () => {
  it('sends a code to the normalized number, verifies it and signs in', async () => {
    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith('/api/auth/otp/request') && init?.method === 'POST') {
        return { phone: '+919876543210' };
      }
      if (url.endsWith('/api/auth/otp/verify') && init?.method === 'POST') {
        return {
          token: 'jwt-otp-1',
          user: {
            id: 'u9',
            email: null,
            phone: '+919876543210',
            firstName: '',
            lastName: '',
            role: 'customer',
          },
        };
      }
      if (url.endsWith('/api/me/orders')) return [];
      return undefined;
    });

    renderApp('/login');
    await userEvent.click(screen.getByRole('button', { name: 'Phone' }));
    await userEvent.type(screen.getByLabelText('Mobile Number'), '98765 43210');
    await userEvent.click(screen.getByRole('button', { name: 'Send Code' }));

    expect(await screen.findByText(/code sent to \+919876543210/)).toBeInTheDocument();
    await userEvent.type(screen.getByLabelText('One-Time Code'), '123456');
    await userEvent.click(screen.getByRole('button', { name: 'Verify & Sign In' }));

    // phone-only account: greeting has no name, session persists with the phone
    expect(await screen.findByText('Welcome back')).toBeInTheDocument();
    const verifyCall = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/api/auth/otp/verify'),
    );
    expect(JSON.parse(String(verifyCall![1]?.body))).toEqual({
      phone: '+919876543210',
      code: '123456',
    });
    const stored = JSON.parse(localStorage.getItem('ta.auth') ?? 'null') as {
      token?: string;
      user?: { phone?: string | null };
    } | null;
    expect(stored?.token).toBe('jwt-otp-1');
    expect(stored?.user?.phone).toBe('+919876543210');
  });

  it('surfaces verify errors in the existing error style and allows changing number', async () => {
    const { container } = (() => {
      mockFetch((url, init) => {
        if (url.endsWith('/api/auth/otp/request') && init?.method === 'POST') {
          return { phone: '+919876543210' };
        }
        return undefined; // verify 404s → { error: 'Not found' }
      });
      return renderApp('/login');
    })();

    await userEvent.click(screen.getByRole('button', { name: 'Phone' }));
    await userEvent.type(screen.getByLabelText('Mobile Number'), '9876543210');
    await userEvent.click(screen.getByRole('button', { name: 'Send Code' }));
    await userEvent.type(await screen.findByLabelText('One-Time Code'), '000000');
    await userEvent.click(screen.getByRole('button', { name: 'Verify & Sign In' }));

    expect(container.querySelector('.auth-err')).toHaveTextContent('Not found');

    await userEvent.click(screen.getByText('Use a different number'));
    expect(screen.getByLabelText('Mobile Number')).toBeInTheDocument();
  });
});

describe('Login — Google sign-in', () => {
  it('unconfigured: clicking Google shows the setup-pending notice and injects no GIS script', async () => {
    mockFetch(() => undefined);
    renderApp('/login');

    await userEvent.click(screen.getByRole('button', { name: 'Google' }));

    expect(await screen.findByText('Google sign-in — setup pending')).toBeInTheDocument();
    expect(document.querySelector(`script[src="${GSI_SRC}"]`)).toBeNull();
    // Apple stays visual-only
    await userEvent.click(screen.getByRole('button', { name: 'Apple' }));
    expect(await screen.findByText('Apple sign-in — coming soon')).toBeInTheDocument();
  });

  it('configured: renders the official button and the callback posts the credential and signs in', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    const initialize = vi.fn();
    const renderButton = vi.fn();
    vi.stubGlobal('google', { accounts: { id: { initialize, renderButton } } });

    const fetchMock = mockFetch((url, init) => {
      if (url.endsWith('/api/auth/google') && init?.method === 'POST') {
        return {
          token: 'jwt-google-1',
          user: {
            id: 'u1',
            email: 'aanya@example.com',
            firstName: 'Aanya',
            lastName: 'Mehra',
            role: 'customer',
          },
        };
      }
      if (url.endsWith('/api/me/orders')) return [];
      return undefined;
    });

    renderApp('/login');

    // window.google was already present → no script tag injected
    expect(document.querySelector(`script[src="${GSI_SRC}"]`)).toBeNull();
    expect(initialize).toHaveBeenCalledTimes(1);
    expect(renderButton).toHaveBeenCalledTimes(1);
    expect(renderButton.mock.calls[0][0]).toHaveClass('google-slot');

    const config = initialize.mock.calls[0][0] as {
      client_id: string;
      callback: (response: { credential: string }) => void;
    };
    expect(config.client_id).toBe('test-client-id');

    await act(async () => {
      config.callback({ credential: 'google-credential-123' });
    });

    const call = fetchMock.mock.calls.find(([input]) =>
      String(input).endsWith('/api/auth/google'),
    );
    expect(call).toBeDefined();
    expect(JSON.parse(String(call![1]?.body))).toEqual({ credential: 'google-credential-123' });

    // session stored and navigated like a normal login
    expect(await screen.findByText('Welcome back, Aanya')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem('ta.auth') ?? 'null') as {
      token?: string;
      user?: { email?: string };
    } | null;
    expect(stored?.token).toBe('jwt-google-1');
    expect(stored?.user?.email).toBe('aanya@example.com');
  });

  it('configured: API errors from the Google callback surface in the existing error style', async () => {
    vi.stubEnv('VITE_GOOGLE_CLIENT_ID', 'test-client-id');
    const initialize = vi.fn();
    vi.stubGlobal('google', { accounts: { id: { initialize, renderButton: vi.fn() } } });

    mockFetch(() => undefined); // every call 404s → { error: 'Not found' }

    const { container } = renderApp('/login');

    const config = initialize.mock.calls[0][0] as {
      callback: (response: { credential: string }) => void;
    };
    await act(async () => {
      config.callback({ credential: 'bad-credential' });
    });

    const err = container.querySelector('.auth-err');
    expect(err).toHaveTextContent('Not found');
  });
});
