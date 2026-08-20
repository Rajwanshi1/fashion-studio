import { useEffect, useRef, useState } from 'react';
import type { MouseEvent as ReactMouseEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { ProductImage } from '../lib/types';
import { prefersReducedMotion } from '../lib/motion';
import ImageSlot from './ImageSlot';

export type GalleryTrigger = 'swipe' | 'drag' | 'dot' | 'thumb' | 'swatch';

interface StageCarouselProps {
  /** Gallery from Product.tsx — already fallback-resolved. */
  images: ProductImage[];
  /** Controlled: Product's `thumb` state. */
  index: number;
  onIndexChange: (i: number, trigger: GalleryTrigger) => void;
  productName: string;
  poseLabel: (img: ProductImage, i: number) => string;
}

/** Threshold before a mousedown becomes a drag rather than a click. */
const DRAG_THRESHOLD_PX = 5;

/** Quiet time after the last scroll event before we call the scroll settled. */
const SETTLE_MS = 200;

/** The stage spans the viewport on mobile and ~60% of it on desktop (pdp.css). */
const STAGE_SIZES = '(max-width: 900px) 100vw, 60vw';

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
  const settleRef = useRef(0);
  const [dragging, setDragging] = useState(false);
  /** Slides that have EVER been the active slide or its neighbour — the only
      ones given a real src. A 12-photo gallery must not fire 12 downloads on
      mount; and once revealed, a slide keeps its src (unloading a scrolled-past
      photo would flash the placeholder on the way back). */
  const [revealed, setRevealed] = useState<Set<number>>(
    () => new Set([index - 1, index, index + 1]),
  );

  const clampIndex = (i: number) => Math.max(0, Math.min(images.length - 1, i));

  // Reveal the active slide's neighbours as the index moves (thumb click,
  // swipe, drag, dot — all funnel through the controlled `index` prop).
  useEffect(() => {
    setRevealed((prev) => {
      const missing = [index - 1, index, index + 1].filter((i) => !prev.has(i));
      if (missing.length === 0) return prev;
      const next = new Set(prev);
      for (const i of missing) next.add(i);
      return next;
    });
  }, [index]);

  // An interrupted smooth scroll never produces a frame at the pending index,
  // so pendingRef cannot rely on exact arrival alone: once scrolling goes
  // quiet, wherever the track settled is the truth — clear the gate and sync.
  const armSettle = () => {
    clearTimeout(settleRef.current);
    settleRef.current = window.setTimeout(() => {
      if (pendingRef.current == null) return;
      pendingRef.current = null;
      const el = trackRef.current;
      if (!el || el.clientWidth === 0) return;
      const i = clampIndex(Math.round(el.scrollLeft / el.clientWidth));
      if (i !== lastEmittedRef.current) {
        lastEmittedRef.current = i;
        onIndexChange(i, 'swipe');
      }
    }, SETTLE_MS);
  };

  const scrollToIndex = (el: HTMLElement, i: number) => {
    pendingRef.current = i;
    el.scrollTo({
      left: i * el.clientWidth,
      behavior: prefersReducedMotion() ? 'auto' : 'smooth',
    });
    // A same-position scrollTo fires no scroll event at all — arm the settle
    // fallback here too so the gate can never stay closed.
    armSettle();
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
  // The parent clamps `thumb` on its side. Reveal around the CURRENT index,
  // not [0,1] — today's caller resets index to 0 with the swap, but a caller
  // that swaps images mid-gallery must not blank its visible slide.
  useEffect(() => {
    trackRef.current?.scrollTo({ left: 0, behavior: 'auto' });
    pendingRef.current = null;
    lastEmittedRef.current = 0;
    setRevealed(new Set([0, 1, index - 1, index, index + 1].filter((n) => n >= 0)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [images]);

  useEffect(
    () => () => {
      cancelAnimationFrame(rafRef.current);
      clearTimeout(settleRef.current);
    },
    [],
  );

  // Scroll → index sync, rAF-throttled (Reveal idiom).
  const onScroll = () => {
    armSettle();
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
    // Any pointer contact (touch included) takes over scroll ownership from a
    // pending programmatic scroll — never leave the sync gate armed.
    pendingRef.current = null;
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
        width={img?.width}
        height={img?.height}
        sizes={STAGE_SIZES}
        placeholderHex={img?.colorHex || undefined}
        eager
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
            {/* Non-adjacent slides render the src-less placeholder until they
                come within one slide of the active index. */}
            <ImageSlot
              src={revealed.has(i) ? img.url : null}
              label={poseLabel(img, i)}
              alt={`${productName} — ${poseLabel(img, i)}`}
              width={img.width}
              height={img.height}
              sizes={STAGE_SIZES}
              placeholderHex={img.colorHex || undefined}
              eager={i === 0}
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
