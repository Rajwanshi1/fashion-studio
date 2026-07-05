import { useEffect } from 'react';

/** Selector list mirrored from reveal.js. */
const SEL = [
  '.sec-head', '.head-center', '.page-hero', '.manifesto',
  '.products > *', '.cats > *', '.pgrid > *', '.coll-grid > *', '.rel-grid > *',
  '.feat-grid > *', '.look-grid > *', '.spread', '.pull',
  '.srow', '.vgrid > *', '.stats > *', '.trust .item',
  '.cart-wrap > *', '.pdp > *', '.oc-grid > *', '.acct > *',
  '.foot-mark', '.news', '.house-cta', '.mto-cta', '.cc-quick',
].join(',');

/** Scroll-reveal system (React port of reveal.js): tags key elements
 *  with .rv, raises them with a 90ms stagger on intersection, respects
 *  prefers-reduced-motion and includes a 4s safety reveal. Re-runs when
 *  `watch` changes (e.g. after data loads). Renders nothing. */
export default function Reveal({ watch }: { watch?: unknown }) {
  useEffect(() => {
    if (typeof window === 'undefined') return;
    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      return;
    }

    const els = Array.from(document.querySelectorAll<HTMLElement>(SEL)).filter(
      (el) => !el.classList.contains('rv'),
    );
    if (els.length === 0) return;

    let io: IntersectionObserver | null = null;
    const pending = new Set<HTMLElement>();
    try {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((e) => {
            if (e.isIntersecting) {
              e.target.classList.add('rv-in');
              pending.delete(e.target as HTMLElement);
              io?.unobserve(e.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
      );
    } catch {
      io = null;
    }

    const rafs: number[] = [];
    els.forEach((el) => {
      const sibs = el.parentElement ? Array.from(el.parentElement.children) : [el];
      const i = Math.max(0, sibs.indexOf(el));
      el.style.setProperty('--rv-d', `${(i % 4) * 90}ms`);
      el.classList.add('rv');
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.9 && r.bottom > 0) {
        rafs.push(
          requestAnimationFrame(() => {
            rafs.push(requestAnimationFrame(() => el.classList.add('rv-in')));
          }),
        );
      } else {
        pending.add(el);
        io?.observe(el);
      }
    });

    let ticking = false;
    const sweep = () => {
      ticking = false;
      pending.forEach((el) => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.95 && r.bottom > 0) {
          el.classList.add('rv-in');
          pending.delete(el);
          io?.unobserve(el);
        }
      });
    };
    const onScroll = () => {
      if (!ticking) {
        ticking = true;
        requestAnimationFrame(sweep);
      }
    };
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    const t1 = setTimeout(sweep, 1200);
    // Safety net: content can never stay hidden.
    const t2 = setTimeout(() => {
      pending.forEach((el) => el.classList.add('rv-in'));
      pending.clear();
    }, 4000);

    return () => {
      window.removeEventListener('scroll', onScroll);
      window.removeEventListener('resize', onScroll);
      clearTimeout(t1);
      clearTimeout(t2);
      rafs.forEach((id) => cancelAnimationFrame(id));
      io?.disconnect();
      // Never leave content hidden after unmount/re-render.
      pending.forEach((el) => el.classList.add('rv-in'));
    };
  }, [watch]);

  return null;
}
