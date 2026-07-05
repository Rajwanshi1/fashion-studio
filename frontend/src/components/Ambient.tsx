import { useEffect } from 'react';

/** Ambient interaction layer (React port of ambient.js):
 *  1) Magnetic CTAs — buttons lean toward the cursor.
 *  2) Hero parallax — slow depth shift on scroll.
 *  Pointer-fine devices only; respects prefers-reduced-motion.
 *  The three.js gold silk-thread cursor trail from the reference is an
 *  optional desktop nicety, intentionally skipped (no external deps). */
export default function Ambient({ watch }: { watch?: unknown }) {
  useEffect(() => {
    if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') return;
    if (window.matchMedia('(prefers-reduced-motion: reduce)').matches) return;
    if (!window.matchMedia('(pointer: fine)').matches) return;

    const cleanups: Array<() => void> = [];

    // ---- Magnetic CTAs ----
    const btns = document.querySelectorAll<HTMLElement>(
      '.btn-buy, .btn-outline, .btn-solid, .btn-ghost',
    );
    btns.forEach((el) => {
      const move = (e: PointerEvent) => {
        const r = el.getBoundingClientRect();
        const dx = e.clientX - (r.left + r.width / 2);
        const dy = e.clientY - (r.top + r.height / 2);
        el.style.transition =
          'transform 320ms cubic-bezier(0.22,1,0.36,1), background 520ms, color 520ms, border-color 520ms';
        el.style.transform = `translate(${dx * 0.14}px,${dy * 0.22}px)`;
      };
      const leave = () => {
        el.style.transform = '';
      };
      el.addEventListener('pointermove', move);
      el.addEventListener('pointerleave', leave);
      cleanups.push(() => {
        el.removeEventListener('pointermove', move);
        el.removeEventListener('pointerleave', leave);
        el.style.transform = '';
      });
    });

    // ---- Hero parallax ----
    const layers = document.querySelectorAll<HTMLElement>(
      'header.hero > .img-slot, .look > .img-slot, .lb-cover > .img-slot, .house-hero > .img-slot',
    );
    if (layers.length) {
      layers.forEach((el) => {
        el.style.willChange = 'transform';
        el.style.transform = 'scale(1.12)';
      });
      let ticking = false;
      const update = () => {
        ticking = false;
        layers.forEach((el) => {
          const parent = el.parentElement;
          if (!parent) return;
          const r = parent.getBoundingClientRect();
          if (r.bottom < 0 || r.top > window.innerHeight) return;
          const progress = (r.top + r.height / 2 - window.innerHeight / 2) / window.innerHeight;
          el.style.transform = `scale(1.12) translateY(${(progress * r.height * 0.06).toFixed(1)}px)`;
        });
      };
      const onScroll = () => {
        if (!ticking) {
          ticking = true;
          requestAnimationFrame(update);
        }
      };
      window.addEventListener('scroll', onScroll, { passive: true });
      update();
      cleanups.push(() => {
        window.removeEventListener('scroll', onScroll);
        layers.forEach((el) => {
          el.style.transform = '';
          el.style.willChange = '';
        });
      });
    }

    return () => cleanups.forEach((fn) => fn());
  }, [watch]);

  return null;
}
