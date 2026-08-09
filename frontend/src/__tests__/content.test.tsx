import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes, Providers } from '../App';
import { DEFAULT_CONTENT, SiteContentProvider, mergeContent, useSiteContent } from '../lib/content';
import { mockFetch, mockFetchDown } from './helpers';

describe('mergeContent', () => {
  it('returns defaults untouched for an empty payload', () => {
    expect(mergeContent({})).toEqual(DEFAULT_CONTENT);
  });

  it('overrides only the provided fields of a section', () => {
    const merged = mergeContent({ hero: { title: 'A New Season' } });
    expect(merged.hero.title).toBe('A New Season');
    expect(merged.hero.eyebrow).toBe(DEFAULT_CONTENT.hero.eyebrow);
  });

  it('treats empty strings as "use default"', () => {
    const merged = mergeContent({ hero: { title: '' } });
    expect(merged.hero.title).toBe(DEFAULT_CONTENT.hero.title);
  });

  it('keeps an explicit image and passes null through as default', () => {
    expect(mergeContent({ hero: { imageUrl: 'https://cdn/x.jpg' } }).hero.imageUrl).toBe(
      'https://cdn/x.jpg',
    );
    expect(mergeContent({ hero: { imageUrl: null } }).hero.imageUrl).toBe(
      DEFAULT_CONTENT.hero.imageUrl,
    );
  });

  it('replaces string lists wholesale when non-empty', () => {
    expect(mergeContent({ ticker: { items: ['Only this'] } }).ticker.items).toEqual(['Only this']);
    expect(mergeContent({ ticker: { items: [] } }).ticker.items).toEqual(
      DEFAULT_CONTENT.ticker.items,
    );
  });

  it('merges trust items and looks per index over defaults', () => {
    const merged = mergeContent({
      trust: {
        items: [
          { title: 'Custom', detail: '' },
          { title: '', detail: '' },
          { title: '', detail: '' },
        ],
      },
    });
    expect(merged.trust.items[0].title).toBe('Custom');
    expect(merged.trust.items[0].detail).toBe(DEFAULT_CONTENT.trust.items[0].detail);
    expect(merged.trust.items[1]).toEqual(DEFAULT_CONTENT.trust.items[1]);
  });

  it('ignores unknown sections and junk values without throwing', () => {
    expect(mergeContent({ bogus: { x: 1 }, hero: 'not-an-object' } as never)).toEqual(
      DEFAULT_CONTENT,
    );
  });

  it('keeps the defaults for looks the admin did not send', () => {
    const merged = mergeContent({
      lookbook: { looks: [{ title: 'Rain, again.', imageUrl: '/img/look-01.jpg' }] },
    });
    expect(merged.lookbook.looks).toHaveLength(DEFAULT_CONTENT.lookbook.looks.length);
    expect(merged.lookbook.looks[0].title).toBe('Rain, again.');
    expect(merged.lookbook.looks[0].imageUrl).toBe('/img/look-01.jpg');
    expect(merged.lookbook.looks[0].copy).toBe(DEFAULT_CONTENT.lookbook.looks[0].copy);
    expect(merged.lookbook.looks[1]).toEqual(DEFAULT_CONTENT.lookbook.looks[1]);
  });

  it('keeps extra looks beyond the built-in ones', () => {
    const extra = { imageUrl: '/img/look-08.jpg', lookNo: 'Look 08', title: 'One more.' };
    const looks = [...DEFAULT_CONTENT.lookbook.looks.map(() => ({})), extra];
    const merged = mergeContent({ lookbook: { looks } });
    expect(merged.lookbook.looks).toHaveLength(DEFAULT_CONTENT.lookbook.looks.length + 1);
    expect(merged.lookbook.looks[DEFAULT_CONTENT.lookbook.looks.length]).toEqual({
      imageUrl: '/img/look-08.jpg',
      lookNo: 'Look 08',
      title: 'One more.',
      copy: '',
      ctaHref: '',
    });
  });

  it('never mutates DEFAULT_CONTENT', () => {
    mergeContent({
      hero: { title: 'Mutant' },
      trust: { items: [{ title: 'Mutant' }] },
      lookbook: { looks: [{ title: 'Mutant' }] },
      ticker: { items: ['Mutant'] },
    });
    expect(DEFAULT_CONTENT.hero.title).toBe('Tanvi Agnihotry');
    expect(DEFAULT_CONTENT.trust.items[0].title).toBe('Made to Order');
    expect(DEFAULT_CONTENT.lookbook.looks[0].title).toBe('The garden, after rain.');
    expect(DEFAULT_CONTENT.ticker.items[0]).toBe('Complimentary Made-to-Order Consultation');
  });
});

function Probe() {
  const content = useSiteContent();
  return <p>{content.hero.title}</p>;
}

describe('SiteContentProvider', () => {
  it('serves the merged API content', async () => {
    mockFetch((url) => (url.endsWith('/api/content') ? { sections: { hero: { title: 'A New Season' } } } : undefined));
    render(
      <SiteContentProvider>
        <Probe />
      </SiteContentProvider>,
    );
    expect(await screen.findByText('A New Season')).toBeInTheDocument();
  });

  it('falls back to the built-in defaults when the API is down', async () => {
    mockFetchDown();
    render(
      <SiteContentProvider>
        <Probe />
      </SiteContentProvider>,
    );
    expect(await screen.findByText(DEFAULT_CONTENT.hero.title)).toBeInTheDocument();
  });
});

/** Content-driven photos describe themselves to a visitor, not to the boutique:
 *  the slot's `label` is an internal instruction ("Look 02", "Lookbook cover —
 *  full bleed editorial") and must not end up as public alt text. */
describe('alt text on content-driven photos', () => {
  const renderRoute = (route: string, sections: Record<string, unknown>) => {
    mockFetch((url) => (url.endsWith('/api/content') ? { sections } : undefined));
    return render(
      <SiteContentProvider>
        <MemoryRouter initialEntries={[route]}>
          <Providers>
            <AppRoutes />
          </Providers>
        </MemoryRouter>
      </SiteContentProvider>,
    );
  };

  it('names the lookbook cover and looks by their own copy', async () => {
    renderRoute('/lookbook', {
      lookbookCover: { imageUrl: '/img/cover.jpg', masthead: 'The Edit' },
      lookbook: {
        looks: [
          { imageUrl: '/img/look-01.jpg', title: 'Rain, again.' },
          { imageUrl: '/img/look-02.jpg', title: '' },
        ],
      },
    });

    expect(await screen.findByAltText('The Edit')).toBeInTheDocument();
    expect(screen.getByAltText('Rain, again.')).toBeInTheDocument();
    // No title of its own — the slot label stands in rather than nothing.
    expect(screen.getByAltText('Look 02')).toBeInTheDocument();
    expect(screen.queryByAltText(/full bleed editorial/)).not.toBeInTheDocument();
  });

  it('names the home hero and featured photos by their headlines', async () => {
    renderRoute('/', {
      hero: { imageUrl: '/img/hero.jpg', title: 'A New Season' },
      featured: { imageUrl: '/img/feature.jpg', title: 'Rang' },
    });

    expect(await screen.findByAltText('A New Season')).toBeInTheDocument();
    expect(screen.getByAltText('Rang')).toBeInTheDocument();
    expect(screen.queryByAltText(/editorial portrait/)).not.toBeInTheDocument();
    expect(screen.queryByAltText(/Drop campaign image/)).not.toBeInTheDocument();
  });
});
