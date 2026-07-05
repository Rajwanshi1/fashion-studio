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
