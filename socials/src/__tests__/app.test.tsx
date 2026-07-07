import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import App from '../App';
import { SOCIALS } from '../config';

describe('Socials link-in-bio page', () => {
  it('renders exactly the 6 links from config, each with its configured href', () => {
    render(<App />);

    SOCIALS.links.forEach((link) => {
      const anchor = screen.getByRole('link', { name: new RegExp(link.label) });
      expect(anchor).toHaveAttribute('href', link.href);
    });
    expect(screen.getAllByRole('link')).toHaveLength(SOCIALS.links.length);
  });

  it('shows the wordmark and tagline', () => {
    render(<App />);

    expect(screen.getAllByText(SOCIALS.wordmark).length).toBeGreaterThan(0);
    expect(screen.getByText(SOCIALS.tagline)).toBeInTheDocument();
  });

  it('shows The Studio address and hours', () => {
    render(<App />);

    expect(screen.getByText('The Studio')).toBeInTheDocument();
    SOCIALS.studio.forEach((line) => {
      expect(screen.getByText(line)).toBeInTheDocument();
    });
    expect(screen.getByText(SOCIALS.hours)).toBeInTheDocument();
  });

  it('shows the footer copyright line', () => {
    render(<App />);

    expect(screen.getByText(`© 2026 ${SOCIALS.wordmark}`)).toBeInTheDocument();
  });

  it('fires a click beacon with the link id when a link is clicked', () => {
    const fetchMock = vi.fn().mockResolvedValue({ ok: true, status: 204 });
    vi.stubGlobal('fetch', fetchMock);
    // Cancel jsdom's (unimplemented) navigation; the app's own click handler
    // on the anchor still runs before this bubbles up to document.
    const cancelNav = (e: Event) => e.preventDefault();
    document.addEventListener('click', cancelNav);

    try {
      render(<App />);
      fireEvent.click(screen.getByRole('link', { name: /WhatsApp/ }));

      expect(fetchMock).toHaveBeenCalledTimes(1);
      const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
      expect(url).toBe('http://localhost:3001/api/socials/click');
      expect(JSON.parse(init.body as string)).toEqual({ link: 'whatsapp' });
    } finally {
      document.removeEventListener('click', cancelNav);
      vi.unstubAllGlobals();
    }
  });

  afterEach(() => {
    sessionStorage.clear();
  });
});
