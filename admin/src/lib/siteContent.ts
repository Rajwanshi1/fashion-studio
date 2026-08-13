/**
 * The storefront sections the boutique can edit from the admin.
 *
 * Three copies of this shape exist by design (each SPA owns its own types, per
 * repo convention): the backend's zod schemas
 * (backend/src/routes/content.routes.ts), the storefront's DEFAULT_CONTENT
 * (frontend/src/lib/content.tsx) and this file. Field names here mirror the
 * backend schemas one-to-one, and the strings in SECTION_DEFAULTS are the
 * storefront's current built-in copy, verbatim — a section the admin has never
 * touched is absent from GET /api/content, so what we show as "Default" has to
 * be exactly what the site renders.
 *
 * Photos with `focus: true` carry sibling focusX/focusY fields (integer percent
 * of the source image, 50/50 = centred) — the storefront's object-position.
 */

export type SectionKey =
  | 'hero'
  | 'featured'
  | 'marquee'
  | 'trust'
  | 'lookbookCover'
  | 'lookbook'
  | 'ticker'
  | 'footer'
  | 'facts';

export type FieldType = 'text' | 'textarea' | 'image' | 'stringList' | 'trustItems' | 'looks';

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  hint?: string;
  /** Image fields (and each look's photo) that carry focusX/focusY siblings. */
  focus?: boolean;
}

export interface SectionConfig {
  key: SectionKey;
  title: string;
  blurb: string;
  fields: FieldConfig[];
}

/** Site order — top of the homepage down, then the site-wide chrome. */
export const SECTIONS: SectionConfig[] = [
  {
    key: 'hero',
    title: 'Hero',
    blurb: 'Home · opening image & headline',
    fields: [
      { name: 'imageUrl', label: 'Photo', type: 'image', hint: 'Full-bleed campaign image.', focus: true },
      { name: 'seasonLabel', label: 'Season label', type: 'text', hint: 'Sideways text on the left edge.' },
      { name: 'eyebrow', label: 'Eyebrow', type: 'text' },
      { name: 'title', label: 'Headline', type: 'text' },
      { name: 'titleItalic', label: 'Headline italic line', type: 'text' },
      { name: 'ctaPrimary', label: 'Primary button', type: 'text' },
      { name: 'ctaSecondary', label: 'Secondary button', type: 'text' },
      { name: 'edgeLeft', label: 'Bottom-left note', type: 'text' },
      { name: 'edgeRight', label: 'Bottom-right note', type: 'text' },
    ],
  },
  {
    key: 'featured',
    title: 'Featured',
    blurb: 'Home · new-collection feature',
    fields: [
      { name: 'imageUrl', label: 'Photo', type: 'image', hint: 'Editorial portrait beside the text.', focus: true },
      { name: 'eyebrow', label: 'Eyebrow', type: 'text' },
      { name: 'title', label: 'Title', type: 'text' },
      { name: 'titleEm', label: 'Title italic word', type: 'text' },
      { name: 'copy', label: 'Copy', type: 'textarea' },
      { name: 'ctaLabel', label: 'Link label', type: 'text' },
      { name: 'ctaHref', label: 'Link target', type: 'text', hint: 'A path on the site, e.g. /collection' },
    ],
  },
  {
    key: 'marquee',
    title: 'Marquee',
    blurb: 'Home · scrolling strip',
    fields: [
      { name: 'items', label: 'Lines', type: 'stringList', hint: 'Up to 8. They scroll on a loop, alternating upright and italic.' },
    ],
  },
  {
    key: 'trust',
    title: 'Trust',
    blurb: 'Home · three promises',
    fields: [
      { name: 'items', label: 'Promises', type: 'trustItems', hint: 'Exactly three — a title and a line of detail each.' },
    ],
  },
  {
    key: 'lookbookCover',
    title: 'Lookbook Cover',
    blurb: 'Home & lookbook cover',
    fields: [
      { name: 'imageUrl', label: 'Photo', type: 'image', hint: 'Full-bleed cover image.', focus: true },
      { name: 'masthead', label: 'Masthead', type: 'text' },
      { name: 'subItems', label: 'Sub-line', type: 'stringList', hint: 'Up to 4 — shown separated by ·' },
    ],
  },
  {
    key: 'lookbook',
    title: 'Lookbook',
    blurb: 'The 7 looks & pull-quote',
    fields: [
      { name: 'looks', label: 'Looks', type: 'looks', hint: 'Seven spreads. Looks 1 and 4 also show their caption.', focus: true },
      { name: 'quote', label: 'Pull-quote', type: 'textarea' },
      { name: 'quoteCite', label: 'Quote credit', type: 'text' },
    ],
  },
  {
    key: 'ticker',
    title: 'Announcement Bar',
    blurb: 'Ticker above the nav',
    fields: [
      { name: 'items', label: 'Messages', type: 'stringList', hint: 'Up to 8 — shown separated by · and scrolled on a loop.' },
    ],
  },
  {
    key: 'footer',
    title: 'Footer',
    blurb: 'Blurb & social links',
    fields: [
      { name: 'blurb', label: 'Blurb', type: 'textarea' },
      { name: 'instagramUrl', label: 'Instagram link', type: 'text', hint: 'Full link, e.g. https://instagram.com/…' },
      { name: 'pinterestUrl', label: 'Pinterest link', type: 'text', hint: 'Full link, e.g. https://pinterest.com/…' },
      { name: 'whatsappUrl', label: 'WhatsApp link', type: 'text', hint: 'Full link, e.g. https://wa.me/…' },
    ],
  },
  {
    key: 'facts',
    title: 'Brand Facts',
    blurb: 'Address, phone & collection name',
    fields: [
      { name: 'addressLines', label: 'Studio address', type: 'stringList', hint: 'Up to 4 lines — Contact page.' },
      { name: 'phone', label: 'Phone', type: 'text', hint: 'Shown on Contact and product pages.' },
      { name: 'email', label: 'Email', type: 'text' },
      { name: 'collectionName', label: 'Current collection', type: 'text', hint: 'Named on the shop page. Piece counts always come from the catalogue.' },
      { name: 'leadStandard', label: 'Lead time — standard sizes', type: 'text' },
      { name: 'leadCustom', label: 'Lead time — made to measure', type: 'text' },
    ],
  },
];

/**
 * The storefront's built-in copy, character-for-character (Home.tsx,
 * Ticker.tsx, Footer.tsx, Lookbook.tsx). Editing a section starts from these,
 * and the canvas previews these until the section is saved.
 *
 * `satisfies` pins every section to its EffectiveContent shape, so a field
 * added to an interface without a default (or vice versa) is a compile error
 * instead of an undefined that surfaces mid-preview.
 */
export const SECTION_DEFAULTS = {
  hero: {
    imageUrl: null,
    focusX: 50,
    focusY: 50,
    seasonLabel: 'Festive 2026',
    eyebrow: 'Hand-embroidered, made to order · Jaipur',
    title: 'Tanvi Agnihotry',
    titleItalic: 'jahan har rang ek kissa sunata hai.',
    ctaPrimary: 'Discover the Collection',
    ctaSecondary: 'Book an Appointment',
    edgeLeft: 'Made to Order — Jaipur',
    edgeRight: 'Rang Mehfil — Vol. 01',
  },
  featured: {
    imageUrl: null,
    focusX: 50,
    focusY: 50,
    eyebrow: 'The New Collection',
    title: 'Rang',
    titleEm: 'Mehfil',
    copy: 'Hand-embroidered festive silhouettes in purple, maroon, ruby pink and ivory. Each piece made to order in our Jaipur atelier, each made to last.',
    ctaLabel: 'Explore the Edit',
    ctaHref: '/collection',
  },
  marquee: {
    items: ['Made to Order', '— hand embroidered —', 'Rang Mehfil', '— Festive 2026 —'],
  },
  trust: {
    items: [
      { title: 'Made to Order', detail: 'Crafted on commission · 4–6 weeks' },
      { title: 'Complimentary Fittings', detail: 'Virtual or in-studio, Jaipur' },
      { title: 'Worldwide Shipping', detail: 'Insured & tracked, on the house' },
    ],
  },
  lookbookCover: {
    imageUrl: null,
    focusX: 50,
    focusY: 50,
    masthead: 'The Edit',
    subItems: ['Volume 01', 'Festive 2026', 'Rang Mehfil'],
  },
  lookbook: {
    looks: [
      {
        imageUrl: null,
        focusX: 50,
        focusY: 50,
        lookNo: 'Look 01',
        title: 'Rang, unhurried.',
        copy: 'A kalidaar kurta set in purple silk — resham lotus and french knots over a pintucked inset.',
        ctaHref: '/collection',
      },
      { imageUrl: null, focusX: 50, focusY: 50, lookNo: 'Look 02', title: '', copy: '', ctaHref: '' },
      { imageUrl: null, focusX: 50, focusY: 50, lookNo: 'Look 03', title: '', copy: '', ctaHref: '' },
      {
        imageUrl: null,
        focusX: 50,
        focusY: 50,
        lookNo: 'Look 04',
        title: 'Mehfil light.',
        copy: 'Mirror-work catching the evening — light moving as you do.',
        ctaHref: '/collection',
      },
      { imageUrl: null, focusX: 50, focusY: 50, lookNo: 'Look 05', title: '', copy: '', ctaHref: '' },
      { imageUrl: null, focusX: 50, focusY: 50, lookNo: 'Look 06', title: '', copy: '', ctaHref: '' },
      { imageUrl: null, focusX: 50, focusY: 50, lookNo: 'Look 07', title: '', copy: '', ctaHref: '' },
    ],
    quote: '"She does not choose between heritage and the present. She wears both, at once."',
    quoteCite: '— Rang Mehfil',
  },
  ticker: {
    items: [
      'Complimentary Made-to-Order Consultation',
      'Worldwide Shipping',
      'Rang Mehfil — Festive 2026',
    ],
  },
  footer: {
    blurb:
      'Hand-embroidered, made to order in our Jaipur atelier. Each piece cut to one woman, finished by one pair of hands.',
    instagramUrl: 'https://instagram.com/tanviagnihotrylabel',
    pinterestUrl: '',
    whatsappUrl: 'https://wa.me/918118892523',
  },
  facts: {
    addressLines: ['B-74, Rajendra Marg', 'Bapu Nagar, Jaipur'],
    phone: '+91 81188 92523',
    email: 'info@tanviagnihotry.com',
    collectionName: 'Rang Mehfil',
    leadStandard: '4–6 weeks',
    leadCustom: '6–8 weeks',
  },
} satisfies { [K in SectionKey]: EffectiveContent[K] };

/* ---- Stored ← default, by the storefront's blank-loses rule ---- */

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function mergeValue(stored: unknown, fallback: unknown): unknown {
  if (stored === undefined || stored === null) return fallback;
  // Focal points — mirror the storefront's mergeNum (frontend content.tsx):
  // a finite number wins, clamped to the percent range; junk loses. Without
  // this, a hand-edited row (zod guards the PUT, not the column) previews a
  // crop the live site would never show.
  if (typeof fallback === 'number') {
    return typeof stored === 'number' && Number.isFinite(stored)
      ? Math.min(100, Math.max(0, stored))
      : fallback;
  }
  if (typeof stored === 'string') return stored.trim() === '' ? fallback : stored;
  if (Array.isArray(stored)) return mergeArray(stored, fallback);
  if (isRecord(stored)) return mergeRecord(stored, isRecord(fallback) ? fallback : {});
  return stored;
}

function mergeArray(stored: unknown[], fallback: unknown): unknown[] {
  const defaults = Array.isArray(fallback) ? fallback : [];
  // Lists of copy (marquee, ticker, sub-lines) are replaced wholesale — an
  // empty or all-blank list falls back to the default. The DEFAULT's shape
  // picks the path, so a junk leaf in a stored row can't route an object into
  // a string list and end up rendered as a React child.
  const copyList = defaults.length > 0 && defaults.every((item) => typeof item === 'string');
  if (copyList || (defaults.length === 0 && stored.every((item) => typeof item === 'string'))) {
    const kept = stored.filter(
      (item): item is string => typeof item === 'string' && item.trim() !== '',
    );
    return kept.length > 0 ? kept : defaults;
  }
  // Lists of rows (trust promises, looks) merge per index over their default.
  const length = Math.max(stored.length, defaults.length);
  return Array.from({ length }, (_, i) => mergeValue(stored[i], defaults[i]));
}

function mergeRecord(
  stored: Record<string, unknown>,
  fallback: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...fallback };
  for (const [name, value] of Object.entries(stored)) {
    merged[name] = mergeValue(value, fallback[name]);
  }
  return merged;
}

/**
 * A section's *effective* content — what the storefront actually renders.
 *
 * A shallow `{ ...defaults, ...stored }` would let a stored `''` win, so a card
 * would preview a blank the site never shows; the storefront and the editor
 * both read blank as "no override" (frontend/src/lib/content.tsx). This applies
 * that rule per field so all three agree.
 */
export function sectionValue(
  key: SectionKey,
  stored: Record<string, unknown> | null,
): Record<string, unknown> {
  return mergeRecord(stored ?? {}, SECTION_DEFAULTS[key]);
}

/* ---- Effective content, typed — what the preview components render ---- */

/**
 * Hand-mirror of the storefront's SiteContent (frontend/src/lib/content.tsx).
 * SECTION_DEFAULTS carries every key of every section, and sectionValue merges
 * stored values over those defaults per field, so the merged records match
 * these shapes structurally — the casts below lean on that.
 */
export interface TrustItemContent {
  title: string;
  detail: string;
}

export interface LookContent {
  imageUrl: string | null;
  focusX: number;
  focusY: number;
  lookNo: string;
  title: string;
  copy: string;
  ctaHref: string;
}

export interface HeroContent {
  imageUrl: string | null;
  focusX: number;
  focusY: number;
  seasonLabel: string;
  eyebrow: string;
  title: string;
  titleItalic: string;
  ctaPrimary: string;
  ctaSecondary: string;
  edgeLeft: string;
  edgeRight: string;
}

export interface FeaturedContent {
  imageUrl: string | null;
  focusX: number;
  focusY: number;
  eyebrow: string;
  title: string;
  titleEm: string;
  copy: string;
  ctaLabel: string;
  ctaHref: string;
}

export interface LookbookCoverContent {
  imageUrl: string | null;
  focusX: number;
  focusY: number;
  masthead: string;
  subItems: string[];
}

export interface LookbookContent {
  looks: LookContent[];
  quote: string;
  quoteCite: string;
}

export interface FooterContent {
  blurb: string;
  instagramUrl: string;
  pinterestUrl: string;
  whatsappUrl: string;
}

export interface FactsContent {
  addressLines: string[];
  phone: string;
  email: string;
  collectionName: string;
  leadStandard: string;
  leadCustom: string;
}

export interface EffectiveContent {
  hero: HeroContent;
  featured: FeaturedContent;
  marquee: { items: string[] };
  trust: { items: TrustItemContent[] };
  lookbookCover: LookbookCoverContent;
  lookbook: LookbookContent;
  ticker: { items: string[] };
  footer: FooterContent;
  facts: FactsContent;
}

/** Every section's effective content in one typed bundle, for the canvas. */
export function effectiveContent(
  sections: Record<string, Record<string, unknown> | null | undefined>,
): EffectiveContent {
  const value = (key: SectionKey) => sectionValue(key, sections[key] ?? null);
  return {
    hero: value('hero') as unknown as HeroContent,
    featured: value('featured') as unknown as FeaturedContent,
    marquee: value('marquee') as unknown as { items: string[] },
    trust: value('trust') as unknown as { items: TrustItemContent[] },
    lookbookCover: value('lookbookCover') as unknown as LookbookCoverContent,
    lookbook: value('lookbook') as unknown as LookbookContent,
    ticker: value('ticker') as unknown as { items: string[] },
    footer: value('footer') as unknown as FooterContent,
    facts: value('facts') as unknown as FactsContent,
  };
}
