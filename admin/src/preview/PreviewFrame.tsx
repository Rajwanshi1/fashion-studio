/**
 * A storefront-accurate render surface: a src-less same-origin iframe with the
 * mirrored storefront CSS injected, children rendered into its body through a
 * React portal.
 *
 * The iframe is the point, not a convenience. It gives the preview its own
 * viewport, so the storefront's desktop-first max-width media queries and
 * 100svh/vh heights resolve against the previewed device width instead of the
 * admin's window — and its own document, so the storefront's unscoped class
 * names (.trust, .foot, .btn-buy…) and the admin's rules for the same names
 * cannot restyle each other.
 *
 * The frame is laid out at the device's real CSS width and transform-scaled
 * down to the pane it sits in. `viewportHeight` fixes the frame height so
 * viewport-relative sections (hero, covers) get a deterministic viewport;
 * without it the frame hugs its content. Either way the visible wrapper crops
 * to the content's own height.
 *
 * Note prod's CSP is CloudFront-only (admin/CLAUDE.md): src-less iframes
 * inherit the parent policy, which already allows inline styles, the Google
 * fonts and https images — but that can only be confirmed on the deployed
 * admin, never under vite.
 */
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { createPortal } from 'react-dom';
import storefrontCss from './storefront.css?raw';

/** Real device widths the previews lay out at before scaling. */
export const PHONE_WIDTH = 390;
export const DESKTOP_WIDTH = 1280;

export type PreviewDevice = 'phone' | 'desktop';

export const DEVICE_WIDTHS: Record<PreviewDevice, number> = {
  phone: PHONE_WIDTH,
  desktop: DESKTOP_WIDTH,
};

/** Viewport heights vh/svh resolve against, per device. */
export const DEVICE_VIEWPORT_HEIGHTS: Record<PreviewDevice, number> = {
  phone: 844,
  desktop: 800,
};

interface PreviewFrameProps {
  /** CSS width the frame lays out at (one of DEVICE_WIDTHS). */
  width: number;
  /** Fix the frame height so vh/svh are deterministic; omit to hug content. */
  viewportHeight?: number;
  /** Storefront page scope the children expect ('page-home' | 'page-lookbook'). */
  pageClass: string;
  /** Names the frame for assistive tech ("Hero preview"). */
  label: string;
  children: ReactNode;
}

const FALLBACK_CONTENT_HEIGHT = 600;

export default function PreviewFrame({
  width,
  viewportHeight,
  pageClass,
  label,
  children,
}: PreviewFrameProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null);
  const [doc, setDoc] = useState<Document | null>(null);
  const [contentHeight, setContentHeight] = useState(viewportHeight ?? FALLBACK_CONTENT_HEIGHT);
  const [paneWidth, setPaneWidth] = useState(0);

  /** Adopt the iframe's document: inject the mirrored CSS, then portal into it. */
  const adopt = useCallback((iframe: HTMLIFrameElement | null) => {
    if (!iframe) {
      setDoc(null);
      return;
    }
    const grab = () => {
      const d = iframe.contentDocument;
      if (!d) return;
      if (!d.head.querySelector('style[data-storefront]')) {
        const style = d.createElement('style');
        style.setAttribute('data-storefront', '');
        style.textContent = storefrontCss;
        d.head.appendChild(style);
      }
      setDoc(d);
    };
    grab();
    // Firefox replaces the initial about:blank document asynchronously — adopt
    // whichever document ends up live.
    iframe.addEventListener('load', grab);
  }, []);

  // The frame's content height, so the wrapper can crop to it (a fixed
  // 844-tall viewport whose section only fills 740 must not leave a blank
  // band on the canvas). jsdom has no ResizeObserver — the fallback stands.
  useEffect(() => {
    if (!doc || typeof ResizeObserver === 'undefined') return;
    const measure = () => setContentHeight(doc.body.scrollHeight || FALLBACK_CONTENT_HEIGHT);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(doc.body);
    return () => ro.disconnect();
  }, [doc]);

  // The pane's width, for the scale factor.
  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap || typeof ResizeObserver === 'undefined') return;
    const measure = () => setPaneWidth(wrap.clientWidth);
    measure();
    const ro = new ResizeObserver(measure);
    ro.observe(wrap);
    return () => ro.disconnect();
  }, []);

  // Never scale up — a phone frame in a wide pane stays life-size.
  const scale = paneWidth > 0 ? Math.min(1, paneWidth / width) : 1;
  const frameHeight = viewportHeight ?? contentHeight;
  const visibleHeight = Math.min(contentHeight, frameHeight);

  return (
    <div
      ref={wrapRef}
      className="pv-wrap"
      style={{ height: Math.round(visibleHeight * scale) }}
    >
      <iframe
        ref={adopt}
        title={label}
        tabIndex={-1}
        style={{
          width,
          height: frameHeight,
          border: 0,
          display: 'block',
          transform: `scale(${scale})`,
          transformOrigin: 'top left',
          // A picture of the site, not a page: taps and scrolls belong to the
          // admin around it (the canvas link, the editor page).
          pointerEvents: 'none',
        }}
      />
      {doc && createPortal(<div className={pageClass}>{children}</div>, doc.body)}
    </div>
  );
}
