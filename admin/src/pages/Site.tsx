/**
 * The Site canvas: a mini-render of the storefront, built from the effective
 * (merged) content, in page order. Every CMS-driven section is one big tap
 * target into its editor; the sections the CMS does not own (nav, categories,
 * bestsellers, newsletter) appear as dimmed ghosts so the page still reads as
 * the page. Previews render inside PreviewFrame iframes so the storefront's
 * own CSS — media queries, viewport units, unscoped class names — behaves.
 */
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { SECTIONS, effectiveContent } from '../lib/siteContent';
import type { SectionKey } from '../lib/siteContent';
import DeviceToggle from '../preview/DeviceToggle';
import EditableSection from '../preview/EditableSection';
import { DEVICE_VIEWPORT_HEIGHTS, DEVICE_WIDTHS } from '../preview/PreviewFrame';
import type { PreviewDevice } from '../preview/PreviewFrame';
import {
  FactsPreview,
  FeaturedPreview,
  FooterPreview,
  HeroPreview,
  LookbookCoverHomePreview,
  LookbookPreview,
  MarqueePreview,
  TickerPreview,
  TrustPreview,
} from '../preview/sections';

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** A section the admin does not edit here — kept in the flow so the canvas
 *  reads as the real page, visibly muted and not tappable. */
function Ghost({ label, note }: { label: string; note: string }) {
  return (
    <div className="canvas-ghost">
      <span className="canvas-ghost-label">{label}</span>
      <span className="canvas-ghost-note">{note}</span>
    </div>
  );
}

export default function Site() {
  const [sections, setSections] = useState<Record<string, unknown> | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [device, setDevice] = useState<PreviewDevice>('phone');

  useEffect(() => {
    let live = true;
    api<{ sections: Record<string, unknown> }>('/api/content')
      .then((data) => {
        if (live) setSections(isRecord(data.sections) ? data.sections : {});
      })
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, []);

  const titles = Object.fromEntries(SECTIONS.map((s) => [s.key, s.title])) as Record<
    SectionKey,
    string
  >;
  const width = DEVICE_WIDTHS[device];
  const viewportHeight = DEVICE_VIEWPORT_HEIGHTS[device];

  /** One canvas section: preview + tap-into-editor, chips from stored state. */
  const editable = (
    key: SectionKey,
    stored: Record<string, unknown>,
    children: React.ReactNode,
    opts: { viewportHeight?: number; pageClass?: string; caption?: string } = {},
  ) => (
    <EditableSection
      sectionKey={key}
      title={titles[key]}
      customised={isRecord(stored[key])}
      width={width}
      viewportHeight={opts.viewportHeight}
      pageClass={opts.pageClass ?? 'page-home'}
      caption={opts.caption}
    >
      {children}
    </EditableSection>
  );

  const site = sections ? effectiveContent(sections as Record<string, Record<string, unknown>>) : null;

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The House · Storefront</span>
        <h1>Site</h1>
        <p className="sub">The storefront as it stands — tap any part to edit it.</p>
      </div>

      {error && <p className="state-note">{error}</p>}
      {!site && !error && <p className="state-note">Loading the storefront…</p>}
      {site && sections && (
        <div className="canvas-wrap">
          <DeviceToggle device={device} onChange={setDevice} />

          <h2 className="canvas-segment">Home page</h2>
          <Ghost label="Navigation" note="Fixed — links and search are not editable" />
          {editable('hero', sections,<HeroPreview hero={site.hero} />, {
            viewportHeight,
          })}
          <Ghost label="Shop by category" note="Managed under Products" />
          {editable('marquee', sections,<MarqueePreview items={site.marquee.items} />)}
          {editable('featured', sections,<FeaturedPreview featured={site.featured} />)}
          <Ghost label="Bestsellers" note="Managed under Products" />
          {editable(
            'lookbookCover',
            sections,
            <LookbookCoverHomePreview lookbookCover={site.lookbookCover} />,
            { viewportHeight },
          )}
          {editable('trust', sections,<TrustPreview items={site.trust.items} />)}
          <Ghost label="Newsletter" note="Fixed — copy and signup are not editable" />
          {editable('footer', sections,<FooterPreview footer={site.footer} />)}

          <h2 className="canvas-segment">Lookbook page</h2>
          {editable(
            'lookbook',
            sections,
            <LookbookPreview lookbookCover={site.lookbookCover} lookbook={site.lookbook} />,
            {
              pageClass: 'page-lookbook',
              caption: 'The cover photo is edited under Lookbook Cover, above.',
            },
          )}

          <h2 className="canvas-segment">Announcement bar</h2>
          {editable('ticker', sections,<TickerPreview items={site.ticker.items} />, {
            caption: 'Scrolls above the nav on every page.',
          })}

          <h2 className="canvas-segment">Site-wide</h2>
          {editable('facts', sections,<FactsPreview facts={site.facts} />, {
            caption:
              'The brand facts every page pulls from — Contact, product lead times, the shop-page collection name. Piece counts always come from the catalogue.',
          })}
        </div>
      )}
    </>
  );
}
