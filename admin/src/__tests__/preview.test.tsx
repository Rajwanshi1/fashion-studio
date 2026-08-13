/**
 * The preview components are markup mirrors of the storefront — these tests
 * render them directly (RTL cannot see into PreviewFrame's iframe portal from
 * `screen`) and pin the structure the mirrored CSS depends on.
 */
import { render, screen, within } from '@testing-library/react';
import PreviewFrame from '../preview/PreviewFrame';
import {
  FooterPreview,
  HeroPreview,
  LookbookPreview,
  MarqueePreview,
  PreviewImage,
  TickerPreview,
  TrustPreview,
  fillTrack,
} from '../preview/sections';
import { effectiveContent } from '../lib/siteContent';

const SITE = effectiveContent({});

describe('PreviewImage', () => {
  it('crops a photo around its focal point', () => {
    render(<PreviewImage src="/img/x.jpg" alt="Photo" focusX={30} focusY={20} />);
    const img = screen.getByAltText('Photo');
    expect(img).toHaveStyle({ objectPosition: '30% 20%' });
    // the canvas mounts ~11 originals, nearly all below the fold
    expect(img).toHaveAttribute('loading', 'lazy');
    expect(img).toHaveAttribute('decoding', 'async');
  });

  it('renders the labelled placeholder when there is no photo', () => {
    render(<PreviewImage label="Drop campaign image" focusX={30} focusY={20} />);
    const slot = screen.getByRole('img', { name: 'Drop campaign image' });
    expect(slot).toHaveClass('img-slot');
    expect(slot).toHaveTextContent('Drop campaign image');
  });
});

describe('section mirrors', () => {
  it('hero: copy lands in the storefront structure', () => {
    const { container } = render(
      <HeroPreview hero={{ ...SITE.hero, title: 'A New Season', imageUrl: '/img/hero.jpg' }} />,
    );
    const h1 = container.querySelector('.hero-inner h1') as HTMLElement;
    expect(h1).toHaveTextContent('A New Season');
    expect(h1.querySelector('.ital')).toHaveTextContent('jahan har rang ek kissa sunata hai.');
    expect(container.querySelector('.hero .veil')).not.toBeNull();
    expect(container.querySelector('.side-label')).toHaveTextContent('Festive 2026');
    expect(screen.getByAltText('A New Season')).toHaveStyle({ objectPosition: '50% 50%' });
    // CTAs are pictures of buttons — nothing to navigate to
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('marquee: doubled track, italics by position within one copy', () => {
    // long enough that fillTrack repeats nothing — the doubling stays visible
    const items = [
      'Made to order in the Mumbai studio',
      'hand embroidered over many weeks',
      'The Verdant Edit — Spring 2026',
    ];
    const { container } = render(<MarqueePreview items={items} />);
    const spans = [...container.querySelectorAll('.marquee-track span')];
    expect(spans).toHaveLength(items.length * 2);
    const italics = spans.map((s) => s.classList.contains('it'));
    expect(italics.slice(3)).toEqual(italics.slice(0, 3));
    expect(italics.slice(0, 3)).toEqual([false, true, false]);
  });

  it('ticker: separators supplied by the track, run repeated to fill the band', () => {
    const { container } = render(<TickerPreview items={['Sale']} />);
    // a single short message is repeated (fillTrack) and then doubled
    expect(screen.getAllByText('Sale').length).toBeGreaterThanOrEqual(4);
    expect(container.querySelectorAll('.ticker-track span').length).toBeGreaterThanOrEqual(8);
    expect(screen.getAllByText('·').length).toBeGreaterThanOrEqual(4);
  });

  it('trust: three promises in the storefront classes', () => {
    const { container } = render(<TrustPreview items={SITE.trust.items} />);
    const titles = [...container.querySelectorAll('.trust .item .t')].map((el) => el.textContent);
    expect(titles).toEqual(['Made to Order', 'Complimentary Fittings', 'Worldwide Shipping']);
  });

  it('footer: blurb, columns and social handles, all inert', () => {
    const { container } = render(
      <FooterPreview footer={{ ...SITE.footer, blurb: 'Studio notes.' }} />,
    );
    expect(container.querySelector('.foot-mark')).toHaveTextContent('Tanvi Agnihotry');
    expect(container.querySelector('.foot-brand p')).toHaveTextContent('Studio notes.');
    expect(screen.getByText('Instagram')).toBeInTheDocument();
    expect(screen.queryByRole('link')).toBeNull();
  });

  it('lookbook: cover, spreads and the mid-page pull-quote, in page order', () => {
    const { container } = render(
      <LookbookPreview lookbookCover={SITE.lookbookCover} lookbook={SITE.lookbook} />,
    );
    expect(container.querySelector('.lb-cover .masthead')).toHaveTextContent('The Edit');

    // the storefront's fixed sequence: text-left → duo → PULL-QUOTE → offset → duo → last spread
    const children = [...(container.querySelector('.lb') as HTMLElement).children];
    expect(children.map((el) => el.className)).toEqual([
      'spread text-left',
      'spread duo',
      'pull',
      'spread offset',
      'spread duo',
      'spread',
    ]);
    expect(within(children[2] as HTMLElement).getByText(/She does not choose/)).toBeInTheDocument();

    // aspect classes per slot
    expect(children[0].querySelector('.img-slot')).toHaveClass('ar54');
    expect(children[1].querySelectorAll('.ar34')).toHaveLength(2);
    expect(children[3].querySelector('.img-slot')).toHaveClass('ar45');

    // only looks 01 and 04 carry captions
    const captions = container.querySelectorAll('.caption');
    expect(captions).toHaveLength(2);
    expect(captions[0]).toHaveTextContent('Rang, unhurried.');
    expect(captions[1]).toHaveTextContent('Mehfil light.');
  });
});

describe('fillTrack mirror', () => {
  it('repeats a short list to span the band and leaves a long one alone', () => {
    expect(fillTrack(['abc'], 9)).toEqual(['abc', 'abc', 'abc']);
    expect(fillTrack(['a'.repeat(40)], 9)).toEqual(['a'.repeat(40)]);
    expect(fillTrack([], 9)).toEqual([]);
  });
});

describe('PreviewFrame', () => {
  it('injects the storefront CSS and portals children into the iframe body', async () => {
    const { container } = render(
      <PreviewFrame width={390} viewportHeight={844} pageClass="page-home" label="Hero preview">
        <p>Inside the frame</p>
      </PreviewFrame>,
    );

    const iframe = container.querySelector('iframe') as HTMLIFrameElement;
    expect(iframe).toHaveAttribute('title', 'Hero preview');
    const doc = iframe.contentDocument as Document;
    const style = doc.head.querySelector('style[data-storefront]') as HTMLStyleElement;
    expect(style.textContent).toContain('.page-home .hero');
    // children render inside the iframe's own document, under the page scope
    const scope = doc.body.querySelector('.page-home') as HTMLElement;
    expect(within(scope).getByText('Inside the frame')).toBeInTheDocument();
    // nothing inside a preview can take a tap — the wrapper link gets it
    expect(iframe.style.pointerEvents).toBe('none');
  });
});
