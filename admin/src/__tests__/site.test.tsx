import { screen } from '@testing-library/react';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';
import { sectionPreview } from '../lib/siteContent';

describe('sectionPreview', () => {
  it('truncates by code point, never through an emoji', () => {
    const out = sectionPreview('hero', { title: `${'a'.repeat(78)}😀 more text` });

    // slicing UTF-16 units at 79 would cut the emoji in half and leave a lone
    // surrogate, which renders as a replacement glyph on the card
    expect(/[\uD800-\uDBFF](?![\uDC00-\uDFFF])/.test(out)).toBe(false);
    expect(out.endsWith('…')).toBe(true);
    expect(out).toBe(`${'a'.repeat(78)}😀…`);
  });

  it('leaves a summary inside the cap alone', () => {
    expect(sectionPreview('hero', { title: 'Tanvi Agnihotry' })).toBe('Tanvi Agnihotry');
  });
});

describe('site content list', () => {
  it('shows a card per section with customised/default badges', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/content')) {
        return { json: { sections: { hero: { title: 'Custom headline' } } } };
      }
      return undefined;
    });

    renderApp('/site');

    expect(await screen.findByText('Hero')).toBeInTheDocument();
    expect(screen.getByText('Announcement Bar')).toBeInTheDocument();
    expect(screen.getByText('Footer')).toBeInTheDocument();
    // hero row is customised, the rest default
    expect(screen.getAllByText('Customised')).toHaveLength(1);
    expect(screen.getAllByText('Default').length).toBeGreaterThan(3);
    // the customised value is what the card previews
    expect(screen.getByText('Custom headline')).toBeInTheDocument();
  });

  it('previews the default when a stored field is blank', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/content')) {
        // Cleared in the editor and saved: the site still shows its built-in
        // copy, so the card has to preview that too — not an empty line.
        return { json: { sections: { hero: { title: '' }, ticker: { items: [] } } } };
      }
      return undefined;
    });

    renderApp('/site');

    expect(await screen.findByText('Tanvi Agnihotry', { selector: '.prev' })).toBeInTheDocument();
    expect(
      screen.getByText(/^Complimentary Made-to-Order Consultation · Worldwide Shipping/),
    ).toBeInTheDocument();
    // still flagged as customised — the section row does exist
    expect(screen.getAllByText('Customised')).toHaveLength(2);
  });

  it('previews built-in defaults and links each card to its editor', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/content')) return { json: { sections: {} } };
      return undefined;
    });

    renderApp('/site');

    expect(await screen.findByText('Tanvi Agnihotry', { selector: '.prev' })).toBeInTheDocument();
    // ticker preview joins its messages and truncates with an ellipsis
    const ticker = screen.getByText(/^Complimentary Made-to-Order Consultation · Worldwide Shipping/);
    expect(ticker).toHaveTextContent(/…$/);
    expect(screen.getByRole('link', { name: /Hero/ })).toHaveAttribute('href', '/site/hero');
    expect(screen.getByRole('link', { name: /Announcement Bar/ })).toHaveAttribute(
      'href',
      '/site/ticker',
    );
  });
});
