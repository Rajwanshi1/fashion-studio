import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import PreviewFrame from './PreviewFrame';
import type { SectionKey } from '../lib/siteContent';

/**
 * One tappable section on the /site canvas: the whole preview is a single
 * Link into that section's editor. The iframe inside is decorative and
 * pointer-inert (PreviewFrame), so the Link takes every tap; its aria-label
 * carries what a sighted admin reads off the preview and the chips.
 */
export default function EditableSection({
  sectionKey,
  title,
  customised,
  width,
  viewportHeight,
  pageClass,
  caption,
  children,
}: {
  sectionKey: SectionKey;
  title: string;
  customised: boolean;
  width: number;
  viewportHeight?: number;
  pageClass: string;
  caption?: string;
  children: ReactNode;
}) {
  return (
    <div className="canvas-sec">
      <Link
        to={`/site/${sectionKey}`}
        className="canvas-hit"
        aria-label={`Edit ${title} — ${customised ? 'customised' : 'default'}`}
      >
        <PreviewFrame
          width={width}
          viewportHeight={viewportHeight}
          pageClass={pageClass}
          label={`${title} preview`}
        >
          {children}
        </PreviewFrame>
        <span className="canvas-chips" aria-hidden="true">
          <span className="canvas-edit">✎ Edit {title}</span>
          <span className={`badge ${customised ? 'custom' : 'default'}`}>
            {customised ? 'Customised' : 'Default'}
          </span>
        </span>
      </Link>
      {caption && <p className="canvas-note">{caption}</p>}
    </div>
  );
}
