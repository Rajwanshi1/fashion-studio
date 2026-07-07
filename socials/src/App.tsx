import { useEffect, useRef } from 'react';
import { SOCIALS } from './config';
import { trackClick } from './track';

/** Rise-in reveal for this page's own sections. The page is short and fixed
 *  (no async content, unlike the storefront's Reveal), so a single mount-time
 *  pass over a handful of `.rv` nodes is enough — but it still has to honor
 *  the same non-negotiable contract: respect prefers-reduced-motion, and
 *  never strand content invisible if the observer never fires (tab
 *  backgrounded, IO unsupported, etc). The safety timeout adds `.revealed-all`
 *  to <html>, which CSS uses to force every `.rv` node visible. */
function useReveal(rootRef: React.RefObject<HTMLElement>) {
  useEffect(() => {
    const root = rootRef.current;
    const html = document.documentElement;
    if (!root) return;

    if (
      typeof window.matchMedia === 'function' &&
      window.matchMedia('(prefers-reduced-motion: reduce)').matches
    ) {
      html.classList.add('revealed-all');
      return;
    }

    const els = Array.from(root.querySelectorAll<HTMLElement>('.rv'));
    els.forEach((el, i) => {
      el.style.setProperty('--rv-d', `${(i % 8) * 90}ms`);
    });

    let io: IntersectionObserver | null = null;
    try {
      io = new IntersectionObserver(
        (entries) => {
          entries.forEach((entry) => {
            if (entry.isIntersecting) {
              entry.target.classList.add('rv-in');
              io?.unobserve(entry.target);
            }
          });
        },
        { threshold: 0.12, rootMargin: '0px 0px -40px 0px' },
      );
      els.forEach((el) => io?.observe(el));
    } catch {
      io = null;
    }

    // Safety net: content must never be stranded invisible.
    const safety = setTimeout(() => {
      html.classList.add('revealed-all');
    }, 1500);

    return () => {
      clearTimeout(safety);
      io?.disconnect();
    };
  }, [rootRef]);
}

export default function App() {
  const rootRef = useRef<HTMLDivElement>(null);
  useReveal(rootRef);

  return (
    <div className="page-socials" ref={rootRef}>
      <main className="sc-main">
        <header className="sc-head rv">
          <p className="sc-word">{SOCIALS.wordmark}</p>
          <p className="sc-tag">{SOCIALS.tagline}</p>
        </header>

        <nav className="sc-links" aria-label="Connect with us">
          {SOCIALS.links.map((link) => (
            <a key={link.href} className="lk rv" href={link.href} onClick={() => trackClick(link.id)}>
              <span className="lk-text">
                <span className="lk-label">{link.label}</span>
                <span className="lk-sub">{link.sub}</span>
              </span>
              <span className="lk-arrow" aria-hidden="true">
                →
              </span>
            </a>
          ))}
        </nav>

        <section className="sc-studio rv">
          <span className="eyebrow">The Studio</span>
          <hr className="rule-gold" />
          <address>
            {SOCIALS.studio.map((line) => (
              <span key={line}>{line}</span>
            ))}
          </address>
          <p className="sc-hours">{SOCIALS.hours}</p>
        </section>
      </main>

      <footer className="sc-foot">
        <span>© 2026 {SOCIALS.wordmark}</span>
      </footer>
    </div>
  );
}
