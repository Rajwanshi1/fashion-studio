/* TANVI AGNIHOTRY — scroll reveal system (shared)
   Auto-tags key elements and reveals them on scroll.
   Safe: skips in iframes (PDF capture), print, reduced motion. */
(function () {
  // Skip only inside same-origin capture frames (All Screens catalog).
  // The user's preview pane is a cross-origin iframe — frameElement throws/null there → run.
  try { if (window.frameElement && window.frameElement.closest('.frame')) return; } catch (e) {}
  if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;

  const SEL = [
    '.sec-head', '.head-center', '.page-hero', '.manifesto',
    '.products > *', '.cats > *', '.pgrid > *', '.coll-grid > *', '.rel-grid > *',
    '.feat-grid > *', '.look-grid > *', '.spread', '.pull',
    '.srow', '.vgrid > *', '.stats > *', '.trust .item',
    '.cart-wrap > *', '.pdp > *', '.oc-grid > *', '.acct > *',
    '.foot-mark', '.news', '.house-cta', '.mto-cta', '.cc-quick'
  ].join(',');

  function init() {
    const els = document.querySelectorAll(SEL);
    let io = null;
    try {
      io = new IntersectionObserver((entries) => {
        entries.forEach(e => {
          if (e.isIntersecting) { e.target.classList.add('rv-in'); io.unobserve(e.target); }
        });
      }, { threshold: 0.12, rootMargin: '0px 0px -40px 0px' });
    } catch (e) {}

    const pending = new Set();

    els.forEach(el => {
      const sibs = el.parentElement ? [...el.parentElement.children] : [el];
      const i = Math.max(0, sibs.indexOf(el));
      el.style.setProperty('--rv-d', (i % 4) * 90 + 'ms');
      el.classList.add('rv');
      const r = el.getBoundingClientRect();
      if (r.top < window.innerHeight * 0.9 && r.bottom > 0) {
        requestAnimationFrame(() => requestAnimationFrame(() => el.classList.add('rv-in')));
      } else {
        pending.add(el);
        if (io) io.observe(el);
      }
    });

    // Fallback: scroll/resize-driven reveal (covers contexts where IO never fires)
    let ticking = false;
    function sweep() {
      ticking = false;
      pending.forEach(el => {
        const r = el.getBoundingClientRect();
        if (r.top < window.innerHeight * 0.95 && r.bottom > 0) {
          el.classList.add('rv-in');
          pending.delete(el);
          if (io) io.unobserve(el);
        }
      });
    }
    function onScroll() { if (!ticking) { ticking = true; requestAnimationFrame(sweep); } }
    window.addEventListener('scroll', onScroll, { passive: true });
    window.addEventListener('resize', onScroll, { passive: true });

    // Safety net: if nothing has revealed shortly after load, reveal everything in view;
    // and after 4s, reveal all so content can never stay hidden.
    setTimeout(sweep, 1200);
    setTimeout(() => { pending.forEach(el => el.classList.add('rv-in')); pending.clear(); }, 4000);

    // reveal everything if printing
    window.addEventListener('beforeprint', () => {
      document.querySelectorAll('.rv').forEach(el => el.classList.add('rv-in'));
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
