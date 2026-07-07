import { fireEvent, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';

const { toDataURL } = vi.hoisted(() => ({
  toDataURL: vi.fn(async () => 'data:image/png;base64,x'),
}));
vi.mock('qrcode', () => ({ toDataURL }));

describe('Socials', () => {
  beforeEach(() => {
    toDataURL.mockClear();
  });
  it('renders scan stats and generates a QR from a typed source', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return {
          json: {
            stats: [
              { source: 'store-window', total: 42, last7: 5, last30: 12, lastScanAt: '2026-07-01T10:00:00Z' },
            ],
            clicks: [],
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

  it('defaults the QR base URL to the storefront /qr-socials path', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return { json: { stats: [], clicks: [] } };
      }
      return undefined;
    });

    renderApp('/socials');
    expect(await screen.findByRole('heading', { name: 'Socials' })).toBeInTheDocument();

    expect(screen.getByLabelText('Base URL')).toHaveValue('https://tanviagnihotry.com/qr-socials');

    await userEvent.type(screen.getByLabelText('Source'), 'Store Window');
    expect(
      await screen.findByText('https://tanviagnihotry.com/qr-socials/?src=store-window'),
    ).toBeInTheDocument();
  });

  it('renders click stats attributed to their QR source, with direct visits marked', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return {
          json: {
            stats: [],
            clicks: [
              { link: 'whatsapp', source: 'store-window', total: 7, last7: 2, last30: 5, lastClickAt: '2026-07-01T10:00:00Z' },
              { link: 'instagram', source: null, total: 3, last7: 1, last30: 3, lastClickAt: '2026-07-02T10:00:00Z' },
            ],
          },
        };
      }
      return undefined;
    });

    renderApp('/socials');

    expect(await screen.findByText('whatsapp')).toBeInTheDocument();
    expect(screen.getByText('store-window')).toBeInTheDocument();
    expect(screen.getByText('7')).toBeInTheDocument();
    expect(screen.getByText('instagram')).toBeInTheDocument();
    expect(screen.getByText('direct')).toBeInTheDocument();
  });

  it('generates the QR on the default white background plus a transparent variant for download', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return { json: { stats: [], clicks: [] } };
      }
      return undefined;
    });

    renderApp('/socials');
    expect(await screen.findByRole('heading', { name: 'Socials' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Source'), 'Store Window');
    await screen.findByAltText('QR code for store-window');

    const url = 'https://tanviagnihotry.com/qr-socials/?src=store-window';
    expect(toDataURL).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ color: expect.objectContaining({ light: '#ffffff' }) }),
    );
    expect(toDataURL).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ color: expect.objectContaining({ light: '#ffffff00' }) }),
    );

    const transparent = screen.getByRole('link', { name: /transparent png/i });
    expect(transparent).toHaveAttribute('download', 'ta-qr-store-window-transparent.png');
    expect(transparent).toHaveAttribute('href', expect.stringMatching(/^data:image\/png/));
    expect(screen.getByRole('link', { name: 'Download PNG' })).toHaveAttribute(
      'download',
      'ta-qr-store-window.png',
    );
  });

  it('regenerates the QR when the background color changes', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return { json: { stats: [], clicks: [] } };
      }
      return undefined;
    });

    renderApp('/socials');
    expect(await screen.findByRole('heading', { name: 'Socials' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Source'), 'Store Window');
    await screen.findByAltText('QR code for store-window');

    fireEvent.change(screen.getByLabelText('Background'), { target: { value: '#c8d8c0' } });

    await waitFor(() =>
      expect(toDataURL).toHaveBeenCalledWith(
        'https://tanviagnihotry.com/qr-socials/?src=store-window',
        expect.objectContaining({ color: expect.objectContaining({ light: '#c8d8c0' }) }),
      ),
    );
  });

  it('accepts a pasted hex code, syncs the swatch, and regenerates the QR', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return { json: { stats: [], clicks: [] } };
      }
      return undefined;
    });

    renderApp('/socials');
    expect(await screen.findByRole('heading', { name: 'Socials' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Source'), 'Store Window');
    await screen.findByAltText('QR code for store-window');

    fireEvent.change(screen.getByLabelText('Background hex'), { target: { value: '#C8D8C0' } });

    expect(screen.getByLabelText('Background')).toHaveValue('#c8d8c0');
    await waitFor(() =>
      expect(toDataURL).toHaveBeenCalledWith(
        'https://tanviagnihotry.com/qr-socials/?src=store-window',
        expect.objectContaining({ color: expect.objectContaining({ light: '#c8d8c0' }) }),
      ),
    );
  });

  it('normalizes hex codes typed without a hash or in 3-digit shorthand', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return { json: { stats: [], clicks: [] } };
      }
      return undefined;
    });

    renderApp('/socials');
    expect(await screen.findByRole('heading', { name: 'Socials' })).toBeInTheDocument();

    const hexInput = screen.getByLabelText('Background hex');

    fireEvent.change(hexInput, { target: { value: '1E2620' } });
    expect(screen.getByLabelText('Background')).toHaveValue('#1e2620');

    fireEvent.change(hexInput, { target: { value: 'abc' } });
    expect(screen.getByLabelText('Background')).toHaveValue('#aabbcc');
  });

  it('ignores invalid hex text and snaps the field back to the color on blur', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return { json: { stats: [], clicks: [] } };
      }
      return undefined;
    });

    renderApp('/socials');
    expect(await screen.findByRole('heading', { name: 'Socials' })).toBeInTheDocument();

    const hexInput = screen.getByLabelText('Background hex');
    fireEvent.change(hexInput, { target: { value: 'oops' } });

    expect(screen.getByLabelText('Background')).toHaveValue('#ffffff');
    expect(hexInput).toHaveValue('oops');

    fireEvent.blur(hexInput);
    expect(hexInput).toHaveValue('#ffffff');
  });

  it('mirrors swatch changes into the hex field', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return { json: { stats: [], clicks: [] } };
      }
      return undefined;
    });

    renderApp('/socials');
    expect(await screen.findByRole('heading', { name: 'Socials' })).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Background'), { target: { value: '#c8d8c0' } });
    expect(screen.getByLabelText('Background hex')).toHaveValue('#c8d8c0');
  });

  it('renders the QR in the brand dark color by default and accepts a pasted QR color', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return { json: { stats: [], clicks: [] } };
      }
      return undefined;
    });

    renderApp('/socials');
    expect(await screen.findByRole('heading', { name: 'Socials' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Source'), 'Store Window');
    await screen.findByAltText('QR code for store-window');

    const url = 'https://tanviagnihotry.com/qr-socials/?src=store-window';
    expect(toDataURL).toHaveBeenCalledWith(
      url,
      expect.objectContaining({ color: expect.objectContaining({ dark: '#1E2620' }) }),
    );

    fireEvent.change(screen.getByLabelText('QR color hex'), { target: { value: '7A1F2B' } });

    expect(screen.getByLabelText('QR color')).toHaveValue('#7a1f2b');
    await waitFor(() =>
      expect(toDataURL).toHaveBeenCalledWith(
        url,
        expect.objectContaining({ color: expect.objectContaining({ dark: '#7a1f2b' }) }),
      ),
    );
  });

  it('warns when the chosen QR color is too close to the background', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return { json: { stats: [], clicks: [] } };
      }
      return undefined;
    });

    renderApp('/socials');
    expect(await screen.findByRole('heading', { name: 'Socials' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Source'), 'Store Window');
    await screen.findByAltText('QR code for store-window');
    expect(screen.queryByText(/low contrast/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('QR color'), { target: { value: '#f5f0e8' } });

    expect(await screen.findByText(/low contrast/i)).toBeInTheDocument();
  });

  it('warns on a background too dark to scan but still renders the QR', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/socials/stats')) {
        return { json: { stats: [], clicks: [] } };
      }
      return undefined;
    });

    renderApp('/socials');
    expect(await screen.findByRole('heading', { name: 'Socials' })).toBeInTheDocument();

    await userEvent.type(screen.getByLabelText('Source'), 'Store Window');
    await screen.findByAltText('QR code for store-window');
    expect(screen.queryByText(/low contrast/i)).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Background'), { target: { value: '#1e2620' } });

    expect(await screen.findByText(/low contrast/i)).toBeInTheDocument();
    expect(screen.getByAltText('QR code for store-window')).toBeInTheDocument();
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
