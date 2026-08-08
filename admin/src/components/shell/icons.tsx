import type { SVGProps } from 'react';

const base: SVGProps<SVGSVGElement> = {
  viewBox: '0 0 24 24',
  fill: 'none',
  stroke: 'currentColor',
  strokeWidth: 1.6,
  strokeLinecap: 'round',
  strokeLinejoin: 'round',
  'aria-hidden': true,
};

export const HomeIcon = () => (
  <svg {...base}>
    <path d="M4 10.5 12 4l8 6.5" />
    <path d="M6 9.5V20h12V9.5" />
    <path d="M10 20v-5h4v5" />
  </svg>
);

export const OrdersIcon = () => (
  <svg {...base}>
    <path d="M7 3h10v18l-2.5-1.6L12 21l-2.5-1.6L7 21Z" />
    <path d="M10 8h4.5M10 12h4.5" />
  </svg>
);

export const DeliveriesIcon = () => (
  <svg {...base}>
    <path d="M3 7h11v10H3Z" />
    <path d="M14 10h4l3 3v4h-7" />
    <circle cx="7" cy="17.5" r="1.6" />
    <circle cx="17.5" cy="17.5" r="1.6" />
  </svg>
);

export const MoreIcon = () => (
  <svg {...base}>
    <circle cx="5" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="12" cy="12" r="1.2" fill="currentColor" stroke="none" />
    <circle cx="19" cy="12" r="1.2" fill="currentColor" stroke="none" />
  </svg>
);

export const BackIcon = () => (
  <svg {...base}>
    <path d="M14.5 5.5 8 12l6.5 6.5" />
  </svg>
);

export const PenIcon = () => (
  <svg {...base}>
    <path d="M5 19l1-4L16.5 4.5a1.9 1.9 0 0 1 2.7 0l.3.3a1.9 1.9 0 0 1 0 2.7L9 18l-4 1Z" />
  </svg>
);

export const CameraIcon = () => (
  <svg {...base}>
    <path d="M4 8h3l1.5-2h7L17 8h3v11H4Z" />
    <circle cx="12" cy="13" r="3.2" />
  </svg>
);
