import { useEffect, useRef, useState } from 'react';
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from 'react';
import type { ProductImage } from '../lib/types';
import { dropIndexForPoint, slotToIndex } from '../lib/reorder';
import type { Rect } from '../lib/reorder';

const POSE_OPTIONS = ['front', 'back', 'side', 'detail'];

interface ThumbStripProps {
  images: ProductImage[];
  /** Splice-move: item leaves `from`, lands at `to`. */
  onReorder: (from: number, to: number) => void;
  onRemove: (index: number) => void;
  onPoseChange: (index: number, pose: string) => void;
}

/** Everything the render needs while a pointer drag is live. */
interface DragState {
  from: number;
  x: number;
  y: number;
  slot: number;
  /** Snapshotted at drag start — never re-read images[from] mid-gesture
      (duplicate URLs + index keys make index lookups unstable). */
  url: string;
  pose: string;
}

/** Mutable gesture bookkeeping that must not trigger renders. */
interface Gesture {
  from: number;
  pointerId: number;
  startX: number;
  startY: number;
  url: string;
  pose: string;
  el: HTMLElement;
  /** Set once the 4px threshold is crossed; the grid never reflows
      mid-drag (we show an insertion line, not a live reorder), so one
      snapshot stays valid for the whole gesture. */
  rects: Rect[] | null;
}

const DRAG_THRESHOLD_PX = 4;

/**
 * Product photo strip with pointer drag-and-drop reordering.
 * Drag starts from the grip handle — the only touch-action:none element,
 * so touch-scrolling the form over the photos keeps working. Keyboard:
 * arrow keys on a focused handle move the photo one slot.
 * No autoscroll: at MAX_IMAGES=12 the strip fits the viewport.
 */
export function ThumbStrip({ images, onReorder, onRemove, onPoseChange }: ThumbStripProps) {
  const [drag, setDrag] = useState<DragState | null>(null);
  const [announce, setAnnounce] = useState('');
  const gestureRef = useRef<Gesture | null>(null);
  const thumbRefs = useRef<(HTMLElement | null)[]>([]);
  const handleRefs = useRef<(HTMLButtonElement | null)[]>([]);
  const pointRef = useRef({ x: 0, y: 0 });
  const rafRef = useRef(0);
  /** Index-keyed handles remount on reorder — focus must be restored by hand. */
  const focusAfterRender = useRef<number | null>(null);

  useEffect(() => {
    if (focusAfterRender.current != null) {
      handleRefs.current[focusAfterRender.current]?.focus();
      focusAfterRender.current = null;
    }
  });

  // Escape abandons a live drag without reordering.
  useEffect(() => {
    if (!drag) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape') return;
      const g = gestureRef.current;
      if (g?.el.hasPointerCapture(g.pointerId)) g.el.releasePointerCapture(g.pointerId);
      gestureRef.current = null;
      setDrag(null);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [drag]);

  useEffect(() => () => cancelAnimationFrame(rafRef.current), []);

  const scheduleDragUpdate = () => {
    if (rafRef.current) return;
    rafRef.current = requestAnimationFrame(() => {
      rafRef.current = 0;
      const g = gestureRef.current;
      if (!g?.rects) return;
      const { x, y } = pointRef.current;
      setDrag({ from: g.from, x, y, slot: dropIndexForPoint(g.rects, x, y), url: g.url, pose: g.pose });
    });
  };

  const onHandlePointerDown = (i: number, e: ReactPointerEvent<HTMLButtonElement>) => {
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    gestureRef.current = {
      from: i,
      pointerId: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      url: images[i].url,
      pose: images[i].pose || '',
      el: e.currentTarget,
      rects: null,
    };
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const onHandlePointerMove = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const g = gestureRef.current;
    if (!g || e.pointerId !== g.pointerId) return;
    if (!g.rects) {
      if (Math.hypot(e.clientX - g.startX, e.clientY - g.startY) < DRAG_THRESHOLD_PX) return;
      g.rects = thumbRefs.current.slice(0, images.length).map((el) => {
        const r = el!.getBoundingClientRect();
        return { left: r.left, top: r.top, width: r.width, height: r.height };
      });
    }
    pointRef.current = { x: e.clientX, y: e.clientY };
    scheduleDragUpdate();
  };

  const onHandlePointerEnd = (e: ReactPointerEvent<HTMLButtonElement>) => {
    const g = gestureRef.current;
    if (!g || e.pointerId !== g.pointerId) return;
    if (g.rects && e.type === 'pointerup') {
      const slot = dropIndexForPoint(g.rects, e.clientX, e.clientY);
      const to = slotToIndex(slot, g.from);
      if (to !== g.from) onReorder(g.from, to);
    }
    if (g.el.hasPointerCapture(g.pointerId)) g.el.releasePointerCapture(g.pointerId);
    gestureRef.current = null;
    cancelAnimationFrame(rafRef.current);
    rafRef.current = 0;
    setDrag(null);
  };

  const onHandleKey = (i: number, e: ReactKeyboardEvent<HTMLButtonElement>) => {
    const delta =
      e.key === 'ArrowLeft' || e.key === 'ArrowUp'
        ? -1
        : e.key === 'ArrowRight' || e.key === 'ArrowDown'
          ? 1
          : 0;
    if (!delta) return;
    e.preventDefault(); // don't scroll the form
    const to = i + delta;
    if (to < 0 || to >= images.length) return;
    focusAfterRender.current = to;
    onReorder(i, to);
    setAnnounce(`Photo moved to position ${to + 1} of ${images.length}`);
  };

  if (images.length === 0) return null;

  return (
    <div className={`thumb-strip${drag?.slot === images.length ? ' drop-end' : ''}`}>
      {images.map((img, i) => (
        <figure
          className={`thumb${drag?.from === i ? ' dragging' : ''}${drag?.slot === i ? ' drop-before' : ''}`}
          key={`${img.url}#${i}`}
          ref={(el) => {
            thumbRefs.current[i] = el;
          }}
        >
          <img
            src={img.url}
            alt={img.pose ? `Product photo ${i + 1} — ${img.pose}` : `Product photo ${i + 1}`}
          />
          {/* The AI naming call guesses the pose; guesses must be correctable. */}
          <select
            className="inp thumb-pose"
            aria-label={`Pose tag for photo ${i + 1}`}
            value={img.pose}
            onChange={(e) => onPoseChange(i, e.target.value)}
          >
            <option value="">No tag</option>
            {POSE_OPTIONS.map((p) => (
              <option key={p} value={p}>
                {p.charAt(0).toUpperCase() + p.slice(1)}
              </option>
            ))}
            {img.pose && !POSE_OPTIONS.includes(img.pose) && (
              <option value={img.pose}>{img.pose}</option>
            )}
          </select>
          <div className="thumb-actions">
            <button
              type="button"
              className="drag-handle"
              ref={(el) => {
                handleRefs.current[i] = el;
              }}
              aria-label={`Reorder image ${i + 1} of ${images.length}`}
              aria-describedby="thumb-reorder-hint"
              onPointerDown={(e) => onHandlePointerDown(i, e)}
              onPointerMove={onHandlePointerMove}
              onPointerUp={onHandlePointerEnd}
              onPointerCancel={onHandlePointerEnd}
              onKeyDown={(e) => onHandleKey(i, e)}
            >
              <svg viewBox="0 0 10 16" width="10" height="16" fill="currentColor" aria-hidden="true">
                <circle cx="2.5" cy="2.5" r="1.4" />
                <circle cx="7.5" cy="2.5" r="1.4" />
                <circle cx="2.5" cy="8" r="1.4" />
                <circle cx="7.5" cy="8" r="1.4" />
                <circle cx="2.5" cy="13.5" r="1.4" />
                <circle cx="7.5" cy="13.5" r="1.4" />
              </svg>
            </button>
            <button type="button" className="ulink" aria-label={`Remove image ${i + 1}`} onClick={() => onRemove(i)}>
              ✕
            </button>
          </div>
        </figure>
      ))}
      {drag && (
        <figure
          className="thumb thumb-ghost"
          style={{ transform: `translate(${drag.x - 48}px, ${drag.y - 64}px)` }}
          aria-hidden="true"
        >
          <img src={drag.url} alt="" />
        </figure>
      )}
      <span id="thumb-reorder-hint" className="sr-only">
        Arrow keys move this photo; drag to reorder.
      </span>
      <div role="status" aria-live="polite" className="sr-only">
        {announce}
      </div>
    </div>
  );
}
