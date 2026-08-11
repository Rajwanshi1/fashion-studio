import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { AppRoutes, Providers } from '../App';
import { DEFAULT_CONTENT, SiteContentProvider, mergeContent, useSiteContent } from '../lib/content';
import Ticker from '../components/Ticker';
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
      focusX: 50,
      focusY: 50,
      lookNo: 'Look 08',
      title: 'One more.',
      copy: '',
      ctaHref: '',
    });
  });

  it('keeps focal points inside 0–100 and falls back on junk', () => {
    expect(mergeContent({ hero: { focusX: 30, focusY: 70 } }).hero).toMatchObject({
      focusX: 30,
      focusY: 70,
    });
    // Absent means centred — the object-fit: cover default the site always had.
    expect(mergeContent({ hero: { title: 'x' } }).hero).toMatchObject({ focusX: 50, focusY: 50 });
    // Junk from an old or hand-edited row must never reach object-position.
    expect(mergeContent({ hero: { focusX: '30' } }).hero.focusX).toBe(50);
    expect(mergeContent({ hero: { focusX: NaN } }).hero.focusX).toBe(50);
    expect(mergeContent({ hero: { focusX: 150, focusY: -20 } }).hero).toMatchObject({
      focusX: 100,
      focusY: 0,
    });
    // Per-look focus merges by index like every other look field.
    const merged = mergeContent({ lookbook: { looks: [{ focusX: 10, focusY: 90 }] } });
    expect(merged.lookbook.looks[0]).toMatchObject({ focusX: 10, focusY: 90 });
    expect(merged.lookbook.looks[1]).toMatchObject({ focusX: 50, focusY: 50 });
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

  it('crops content photos around their focal point', async () => {
    renderRoute('/', {
      hero: { imageUrl: '/img/hero.jpg', title: 'A New Season', focusX: 30, focusY: 20 },
      featured: { imageUrl: '/img/feature.jpg', title: 'Rang' },
    });

    // The saved focal point steers the object-fit: cover crop…
    expect(await screen.findByAltText('A New Season')).toHaveStyle({ objectPosition: '30% 20%' });
    // …and a photo saved before focal points existed stays centred.
    expect(screen.getByAltText('Rang')).toHaveStyle({ objectPosition: '50% 50%' });
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

/** Both scrollers translate a doubled track -50% to loop: the two halves have
 *  to be the same copy, and one half has to be wide enough to fill the band. */
describe('scrolling tracks', () => {
  const renderTicker = (sections: Record<string, unknown>) => {
    mockFetch((url) => (url.endsWith('/api/content') ? { sections } : undefined));
    return render(
      <SiteContentProvider>
        <Ticker />
      </SiteContentProvider>,
    );
  };

  const renderHome = (sections: Record<string, unknown>) => {
    mockFetch((url) => (url.endsWith('/api/content') ? { sections } : undefined));
    return render(
      <SiteContentProvider>
        <MemoryRouter initialEntries={['/']}>
          <Providers>
            <AppRoutes />
          </Providers>
        </MemoryRouter>
      </SiteContentProvider>,
    );
  };

  it('prints each default ticker message exactly twice, repeating nothing', async () => {
    const { container } = renderTicker({});

    await screen.findAllByText(DEFAULT_CONTENT.ticker.items[0]);
    for (const message of DEFAULT_CONTENT.ticker.items) {
      expect(screen.getAllByText(message)).toHaveLength(2);
    }
    // message + '·', for each half of the loop
    expect(container.querySelectorAll('.ticker-track span')).toHaveLength(
      DEFAULT_CONTENT.ticker.items.length * 4,
    );
  });

  it('repeats a single short message so the bar is never half empty', async () => {
    renderTicker({ ticker: { items: ['Sale'] } });

    // one message doubled would leave the band blank between wraps, with a pop
    // on every loop — the track is filled out to the built-in run first
    expect((await screen.findAllByText('Sale')).length).toBeGreaterThanOrEqual(4);
  });

  it('italicises the same marquee lines in both halves of an odd-length list', async () => {
    const items = [
      'Made to order in the Mumbai studio',
      'hand embroidered over many weeks',
      'The Verdant Edit — Spring 2026',
    ];
    const { container } = renderHome({ marquee: { items } });

    await screen.findAllByText(items[0]);
    const spans = [...container.querySelectorAll('.marquee-track span')];
    expect(spans).toHaveLength(items.length * 2);

    const italics = spans.map((span) => span.classList.contains('it'));
    const half = italics.length / 2;
    // parity by position in the whole track would flip on an odd count, so the
    // loop would visibly restyle every line each time it wrapped
    expect(italics.slice(half)).toEqual(italics.slice(0, half));
    expect(italics.slice(0, half)).toEqual([false, true, false]);
  });
});
