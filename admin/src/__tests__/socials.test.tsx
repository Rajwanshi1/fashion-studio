import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';

vi.mock('qrcode', () => ({
  toDataURL: async () => 'data:image/png;base64,x',
}));

describe('Socials', () => {
  it('renders scan stats and generates a QR from a typed source', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return {
          json: {
            stats: [
              { source: 'store-window', total: 42, last7: 5, last30: 12, lastScanAt: '2026-07-01T10:00:00Z' },
            ],
          },
        };
      }
      return undefined;
    });

    renderApp('/socials');

    expect(await screen.findByRole('heading', { name: 'Socials' })).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'Socials' })).toBeInTheDocument();

    // stats table
    expect(await screen.findByText('store-window')).toBeInTheDocument();
    expect(screen.getByText('42')).toBeInTheDocument();

    // typing a source produces a normalized slug preview + a QR image
    const sourceInput = screen.getByLabelText('Source');
    await userEvent.type(sourceInput, 'Store Window!');

    expect(screen.getByText('store-window', { selector: '.slug' })).toBeInTheDocument();

    const qr = await screen.findByAltText('QR code for store-window');
    expect(qr).toHaveAttribute('src', expect.stringMatching(/^data:image\/png/));
  });

  it('warns and withholds the QR when the normalized slug fails the backend leading-char rule', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return { json: { stats: [] } };
      }
      return undefined;
    });

    renderApp('/socials');
    expect(await screen.findByRole('heading', { name: 'Socials' })).toBeInTheDocument();

    const sourceInput = screen.getByLabelText('Source');
    await userEvent.type(sourceInput, '-window-display');

    expect(screen.getByText('-window-display', { selector: '.slug' })).toBeInTheDocument();
    expect(
      await screen.findByText(/invalid source/i, { selector: '.form-err' }),
    ).toBeInTheDocument();
    expect(screen.queryByAltText(/QR code for/i)).not.toBeInTheDocument();
  });

  it('warns and withholds the QR when the normalized slug exceeds the backend length limit', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return { json: { stats: [] } };
      }
      return undefined;
    });

    renderApp('/socials');
    expect(await screen.findByRole('heading', { name: 'Socials' })).toBeInTheDocument();

    const sourceInput = screen.getByLabelText('Source');
    const longLabel = 'a'.repeat(70);
    await userEvent.type(sourceInput, longLabel);

    expect(
      await screen.findByText(/invalid source/i, { selector: '.form-err' }),
    ).toBeInTheDocument();
    expect(screen.queryByAltText(/QR code for/i)).not.toBeInTheDocument();
  });
});
