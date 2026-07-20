/** Interim brand emblem — swap the SVG below for the official logo asset when provided. */
export default function BrandLogo({ size = '1.25em' }: { size?: string }) {
  return (
    <svg
      viewBox="0 0 48 48"
      width={size}
      height={size}
      fill="none"
      aria-hidden="true"
      style={{ verticalAlign: '-0.3em', marginRight: '0.45em' }}
    >
      <circle cx="24" cy="24" r="22.5" stroke="currentColor" strokeWidth="1.4" />
      <rect x="16" y="16" width="16" height="16" transform="rotate(45 24 24)" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="24" cy="24" r="1.8" fill="currentColor" />
    </svg>
  );
}
