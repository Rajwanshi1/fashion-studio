/** Magnifier icon. U+2315 ⌕ has patchy glyph coverage in Jost/system
 *  fallbacks, so every search affordance draws the same inline SVG instead.
 *  Sized 1em so it scales with the surrounding `.ic` slot's font-size. */
export default function SearchIcon({ size = '1em' }: { size?: string | number }) {
  return (
    <svg
      viewBox="0 0 24 24"
      width={size}
      height={size}
      fill="none"
      stroke="currentColor"
      strokeWidth="1.5"
      strokeLinecap="round"
      aria-hidden="true"
    >
      <circle cx="11" cy="11" r="7" />
      <line x1="16.2" y1="16.2" x2="21" y2="21" />
    </svg>
  );
}
