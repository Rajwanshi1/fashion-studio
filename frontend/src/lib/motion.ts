/** Single source of truth for the reduced-motion check — Reveal, Ambient and
 *  StageCarousel must all honour it the same way. matchMedia is feature-tested
 *  because jsdom only has it via the test stub. */
export function prefersReducedMotion(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-reduced-motion: reduce)').matches
  );
}
