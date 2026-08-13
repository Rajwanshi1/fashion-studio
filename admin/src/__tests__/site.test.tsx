import { screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { render } from '@testing-library/react';
import { mockFetch, renderApp, seedAdminAuth } from '../test/utils';
import { effectiveContent } from '../lib/siteContent';
import DeviceToggle from '../preview/DeviceToggle';

/** All eight canvas tap targets, by their accessible edit-link names. */
const EDIT_LINKS = [
  'Hero',
  'Marquee',
  'Featured',
  'Lookbook Cover',
  'Trust',
  'Footer',
  'Lookbook',
  'Announcement Bar',
];

function stubContent(sections: Record<string, unknown>) {
  return mockFetch((url) => {
    if (url.endsWith('/api/content')) return { json: { sections } };
    return undefined;
  });
}

describe('effectiveContent', () => {
  it('merges stored sections over the built-in copy, blank losing', () => {
    const site = effectiveContent({
      hero: { title: 'Custom headline', eyebrow: '' },
      ticker: { items: [] },
    });
    expect(site.hero.title).toBe('Custom headline');
    // blank loses to the default, exactly as the storefront merges
    expect(site.hero.eyebrow).toBe('Hand-embroidered, made to order · Jaipur');
    expect(site.ticker.items[0]).toBe('Complimentary Made-to-Order Consultation');
    // untouched sections arrive whole
    expect(site.trust.items).toHaveLength(3);
    expect(site.lookbook.looks).toHaveLength(7);
    expect(site.hero.focusX).toBe(50);
  });

  it('never previews a crop or a list the storefront would not render', () => {
    // zod guards the PUT, not the column — a hand-edited row must not make the
    // canvas diverge from the live site (or crash it)
    const site = effectiveContent({
      hero: { focusX: 150, focusY: '30' },
      ticker: { items: [{ evil: true }, 'Made to order', '  '] },
    } as Record<string, Record<string, unknown>>);
    expect(site.hero.focusX).toBe(100); // clamped, like the storefront
    expect(site.hero.focusY).toBe(50); // junk loses to the default
    // the object leaf is dropped instead of being rendered as a React child
    expect(site.ticker.items).toEqual(['Made to order']);
  });
});

describe('site canvas', () => {
  it('renders every section as a tap target, chipped customised or default', async () => {
    seedAdminAuth();
    stubContent({ hero: { title: 'Custom headline' } });

    renderApp('/site');

    // one edit link per section, the whole preview being the target
    for (const name of EDIT_LINKS) {
      expect(
        await screen.findByRole('link', { name: new RegExp(`^Edit ${name} —`) }),
      ).toBeInTheDocument();
    }
    // the hero is the one customised section — said in its accessible name too
    expect(screen.getByRole('link', { name: 'Edit Hero — customised' })).toHaveAttribute(
      'href',
      '/site/hero',
    );
    expect(screen.getByRole('link', { name: 'Edit Marquee — default' })).toHaveAttribute(
      'href',
      '/site/marquee',
    );
    expect(screen.getAllByText('Customised')).toHaveLength(1);
    expect(screen.getAllByText('Default')).toHaveLength(7);
  });

  it('keeps the fixed sections visible as ghosts, not links', async () => {
    seedAdminAuth();
    stubContent({});

    renderApp('/site');
    await screen.findByRole('link', { name: /^Edit Hero/ });

    for (const label of ['Navigation', 'Shop by category', 'Bestsellers', 'Newsletter']) {
      const ghost = screen.getByText(label).closest('.canvas-ghost');
      expect(ghost).not.toBeNull();
      expect(within(ghost as HTMLElement).queryByRole('link')).toBeNull();
    }
    // ghosts say where those sections ARE managed
    expect(screen.getAllByText('Managed under Products')).toHaveLength(2);
  });

  it('tapping a section opens its editor', async () => {
    seedAdminAuth();
    stubContent({});

    renderApp('/site');

    await userEvent.click(await screen.findByRole('link', { name: /^Edit Hero/ }));
    expect(await screen.findByRole('heading', { name: 'Hero' })).toBeInTheDocument();
    expect(screen.getByLabelText('Headline')).toHaveValue('Tanvi Agnihotry');
  });

  it('renders the section previews inside their own iframes', async () => {
    seedAdminAuth();
    stubContent({ hero: { title: 'Custom headline' } });

    const { container } = renderApp('/site');
    await screen.findByRole('link', { name: /^Edit Hero/ });

    const frames = container.querySelectorAll('iframe');
    expect(frames.length).toBeGreaterThanOrEqual(8);
    // the hero preview lives in the first frame: storefront CSS + merged copy
    const heroDoc = frames[0].contentDocument as Document;
    expect(heroDoc.head.querySelector('style[data-storefront]')).not.toBeNull();
    expect(within(heroDoc.body).getByText('Custom headline')).toBeInTheDocument();
    // blank-loses: the untouched italic line previews the built-in copy
    expect(within(heroDoc.body).getByText('jahan har rang ek kissa sunata hai.')).toBeInTheDocument();
  });

  it('shows loading, then an error when the fetch fails', async () => {
    seedAdminAuth();
    mockFetch((url) => {
      if (url.endsWith('/api/content')) return { status: 500, json: { error: 'Sections are away' } };
      return undefined;
    });

    renderApp('/site');

    expect(await screen.findByText('Sections are away')).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /^Edit Hero/ })).not.toBeInTheDocument();
  });
});

describe('device toggle', () => {
  it('flips aria-pressed between phone and desktop', async () => {
    const onChange = vi.fn();
    render(<DeviceToggle device="phone" onChange={onChange} />);

    expect(screen.getByRole('button', { name: 'Phone' })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: 'Desktop' })).toHaveAttribute('aria-pressed', 'false');

    await userEvent.click(screen.getByRole('button', { name: 'Desktop' }));
    expect(onChange).toHaveBeenCalledWith('desktop');
  });
});
