/**
 * The editor's live preview: renders one section from the exact body a Save
 * would PUT, merged over the built-in defaults the way the storefront merges
 * (sectionValue) — so clearing a field previews the default it falls back to,
 * keystroke by keystroke.
 */
import PreviewFrame, { DEVICE_VIEWPORT_HEIGHTS, DEVICE_WIDTHS } from './PreviewFrame';
import type { PreviewDevice } from './PreviewFrame';
import {
  ArchivePreview,
  FactsPreview,
  FeaturedPreview,
  FooterPreview,
  HeroPreview,
  LookbookCoverHomePreview,
  LookbookPreview,
  MarqueePreview,
  TickerPreview,
  TrustPreview,
} from './sections';
import { sectionValue } from '../lib/siteContent';
import type {
  ArchiveContent,
  FactsContent,
  FeaturedContent,
  FooterContent,
  HeroContent,
  LookbookContent,
  LookbookCoverContent,
  SectionKey,
  TrustItemContent,
} from '../lib/siteContent';

export default function SectionLivePreview({
  sectionKey,
  body,
  coverStored,
  device,
}: {
  sectionKey: SectionKey;
  /** The section exactly as Save would PUT it (payload(config, form)). */
  body: Record<string, unknown>;
  /** Stored lookbookCover row — the lookbook page preview renders under it. */
  coverStored?: Record<string, unknown> | null;
  device: PreviewDevice;
}) {
  const width = DEVICE_WIDTHS[device];
  const viewportHeight = DEVICE_VIEWPORT_HEIGHTS[device];
  const value = sectionValue(sectionKey, body);

  switch (sectionKey) {
    case 'hero':
      return (
        <PreviewFrame width={width} viewportHeight={viewportHeight} pageClass="page-home" label="Hero preview">
          <HeroPreview hero={value as unknown as HeroContent} />
        </PreviewFrame>
      );
    case 'featured':
      return (
        <PreviewFrame width={width} pageClass="page-home" label="Featured preview">
          <FeaturedPreview featured={value as unknown as FeaturedContent} />
        </PreviewFrame>
      );
    case 'marquee':
      return (
        <PreviewFrame width={width} pageClass="page-home" label="Marquee preview">
          <MarqueePreview items={(value as { items?: string[] }).items ?? []} />
        </PreviewFrame>
      );
    case 'trust':
      return (
        <PreviewFrame width={width} pageClass="page-home" label="Trust preview">
          <TrustPreview items={(value as { items?: TrustItemContent[] }).items ?? []} />
        </PreviewFrame>
      );
    case 'lookbookCover':
      return (
        <PreviewFrame width={width} viewportHeight={viewportHeight} pageClass="page-home" label="Lookbook cover preview">
          <LookbookCoverHomePreview lookbookCover={value as unknown as LookbookCoverContent} />
        </PreviewFrame>
      );
    case 'lookbook':
      return (
        <PreviewFrame width={width} pageClass="page-lookbook" label="Lookbook preview">
          <LookbookPreview
            lookbookCover={
              sectionValue('lookbookCover', coverStored ?? null) as unknown as LookbookCoverContent
            }
            lookbook={value as unknown as LookbookContent}
          />
        </PreviewFrame>
      );
    case 'ticker':
      return (
        <PreviewFrame width={width} pageClass="page-home" label="Announcement bar preview">
          <TickerPreview items={(value as { items?: string[] }).items ?? []} />
        </PreviewFrame>
      );
    case 'footer':
      return (
        <PreviewFrame width={width} pageClass="page-home" label="Footer preview">
          <FooterPreview footer={value as unknown as FooterContent} />
        </PreviewFrame>
      );
    // Plain-card previews — these sections render inside existing pages (or a
    // page storefront.css does not mirror), so there is no markup to imitate.
    case 'facts':
      return <FactsPreview facts={value as unknown as FactsContent} />;
    case 'archive':
      return <ArchivePreview archive={value as unknown as ArchiveContent} />;
  }
}
