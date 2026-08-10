import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { ProductImage } from '../lib/types';
import ImageSlot from './ImageSlot';

export type GalleryTrigger = 'swipe' | 'drag' | 'dot' | 'thumb';

interface StageCarouselProps {
  /** Gallery from Product.tsx — already fallback-resolved. */
  images: ProductImage[];
  /** Controlled: Product's `thumb` state. */
  index: number;
  onIndexChange: (i: number, trigger: GalleryTrigger) => void;
  productName: string;
  poseLabel: (img: ProductImage, i: number) => string;
}

/** Same guard as Reveal — smooth scrolling must collapse to instant jumps. */
const prefersReduced = () =>
  typeof window.matchMedia === 'function' &&
  window.matchMedia('(prefers-reduced-motion: reduce)').matches;

/** Threshold before a mousedown becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 5;

/**
 * PDP stage as a scroll-snap carousel. Touch swipes ride the native
 * scroll (no touch-action override, so vertical page scroll over the
 * stage keeps working); mouse/pen get a drag-to-scroll layer; the
 * scroll listener keeps the controlled index in sync either way.
 * Single-image galleries render the plain stage slot — no track, no dots.
 */
export default function StageCarousel({
  images,
  index,
  onIndexChange,
  productName,
  poseLabel,
}: StageCarouselProps) {
  const trackRef = useRef<HTMLDivElement>(null);
  /** Programmatic smooth-scroll target — intermediate scroll events are
      swallowed so a 3-slide thumbnail jump doesn't flicker the active thumb. */
  const pendingRef = useRef<number | null>(null);
  /** Last index this component emitted (or was told about) — distinguishes
      self-originated prop changes from parent commands like thumbnail clicks. */
  const lastEmittedRef = useRef(index);
  const rafRef = useRef(0);
  const dragRef = useRef<{
    startX: number;
    startScroll: number;
    pointerId: number;
    dragged: boolean;
  } | null>(null);
  const justDraggedRef = useRef(false);
  const [dragging, setDragging] = useState(false);

  const clampIndex = (i: number) => Math.max(0, Math.min(images.length - 1, i));

  const scrollToIndex = (el: HTMLElement, i: number) => {
    pendingRef.current = i;
    el.scrollTo({ left: i * el.clientWidth, behavior: prefersReduced() ? 'auto' : 'smooth' });
  };

  // Parent-driven index changes (thumbnail clicks) scroll the track.
  useEffect(() => {
    const el = trackRef.current;
    if (!el || lastEmittedRef.current === index) return;
    lastEmittedRef.current = index;
    scrollToIndex(el, index);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [index]);

  // New gallery (product switch / edited piece): jump back to the start.
  // The parent clamps `thumb` on its side.
  useEffect(() => {
    trackRef.current?.scrollTo({ left: 0, behavior: 'auto' });
    pendingRef.current = null;
    lastEmittedRef.current = 0;
  }, [images]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  // Scroll → index sync, rAF-throttled (Reveal idiom).
  const onScroll = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const el = trackRef.current;
      if (!el || el.clientWidth === 0) return;
      const i = clampIndex(Math.round(el.scrollLeft / el.clientWidth));
      if (pendingRef.current != null) {
        if (i === pendingRef.current) pendingRef.current = null;
        return;
      }
      // A live mouse drag emits once on release (as 'drag'), not per frame here.
      if (dragRef.current?.dragged) return;
      if (i !== lastEmittedRef.current) {
        lastEmittedRef.current = i;
        onIndexChange(i, 'swipe');
      }
    });
  };

  // Mouse/pen drag-to-scroll. Touch returns early — native pan + snap owns it.
  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === 'touch' || e.button !== 0) return;
    const el = trackRef.current;
    if (!el) return;
    dragRef.current = {
      startX: e.clientX,
      startScroll: el.scrollLeft,
      pointerId: e.pointerId,
      dragged: false,
    };
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const el = trackRef.current;
    if (!d || !el || e.pointerId !== d.pointerId) return;
    const dx = e.clientX - d.startX;
    if (!d.dragged && Math.abs(dx) < DRAG_THRESHOLD_PX) return;
    if (!d.dragged) {
      d.dragged = true;
      el.setPointerCapture(d.pointerId);
      setDragging(true); // .dragging turns snap off so scrollLeft writes stick
    }
    el.scrollLeft = d.startScroll - dx;
  };

  const endDrag = (e: ReactPointerEvent<HTMLDivElement>) => {
    const d = dragRef.current;
    const el = trackRef.current;
    if (!d || e.pointerId !== d.pointerId) return;
    dragRef.current = null;
    if (!d.dragged || !el) return;
    if (el.hasPointerCapture(d.pointerId)) el.releasePointerCapture(d.pointerId);
    setDragging(false);
    justDraggedRef.current = true;
    const i = clampIndex(Math.round(el.scrollLeft / el.clientWidth));
    scrollToIndex(el, i); // manual snap — mandatory snap was off during the drag
    if (i !== lastEmittedRef.current) {
      lastEmittedRef.current = i;
      onIndexChange(i, 'drag');
    }
  };

  // A drag must not fall through as a click on whatever it ends over.
  const suppressClickAfterDrag = (e: ReactMouseEvent<HTMLDivElement>) => {
    if (justDraggedRef.current) {
      e.preventDefault();
      e.stopPropagation();
    }
    justDraggedRef.current = false;
  };

  const goToDot = (i: number) => {
    if (i === index) return;
    const el = trackRef.current;
    if (el) scrollToIndex(el, i);
    lastEmittedRef.current = i;
    onIndexChange(i, 'dot');
  };

  if (images.length <= 1) {
    const img = images[0];
    return (
      <ImageSlot
        src={img?.url ?? null}
        label={productName}
        alt={img ? `${productName} — ${poseLabel(img, 0)}` : productName}
      />
    );
  }

  return (
    <>
      <div
        className={`stage-track${dragging ? ' dragging' : ''}`}
        ref={trackRef}
        onScroll={onScroll}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        onClickCapture={suppressClickAfterDrag}
        onDragStart={(e) => e.preventDefault()} // kill the native img ghost-drag
        aria-roledescription="carousel"
        aria-label={`${productName} photos`}
      >
        {images.map((img, i) => (
          <div className="stage-slide" key={`${img.url}-${i}`} aria-hidden={i !== index}>
            <ImageSlot
              src={img.url}
              label={poseLabel(img, i)}
              alt={`${productName} — ${poseLabel(img, i)}`}
            />
          </div>
        ))}
      </div>
      <div className="stage-dots">
        {images.map((_, i) => (
          <button
            key={i}
            type="button"
            className={i === index ? 'active' : ''}
            aria-label={`Go to photo ${i + 1} of ${images.length}`}
            aria-current={i === index}
            onClick={() => goToDot(i)}
          />
        ))}
      </div>
    </>
  );
}
