// Site content: the storefront's editorial copy, with admin overrides layered
// over built-in defaults. `GET /api/content` returns only the sections an admin
// has actually edited, so an empty CMS renders exactly like the hardcoded site.

import { createContext, useContext, useEffect, useState } from 'react';
import type { ReactNode } from 'react';
import { api } from './api';

export interface TrustItem {
  title: string;
  detail: string;
}

export interface Look {
  imageUrl: string | null;
  // Focal point, percent of the source photo — object-position for the crop.
  focusX: number;
  focusY: number;
  lookNo: string;
  title: string;
  copy: string;
  ctaHref: string;
}

export interface SiteContent {
  hero: {
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
  };
  featured: {
    imageUrl: string | null;
    focusX: number;
    focusY: number;
    eyebrow: string;
    title: string;
    titleEm: string;
    copy: string;
    ctaLabel: string;
    ctaHref: string;
  };
  marquee: { items: string[] };
  trust: { items: TrustItem[] };
  lookbookCover: {
    imageUrl: string | null;
    focusX: number;
    focusY: number;
    masthead: string;
    subItems: string[];
  };
  lookbook: { looks: Look[]; quote: string; quoteCite: string };
  ticker: { items: string[] };
  footer: { blurb: string; instagramUrl: string; pinterestUrl: string; whatsappUrl: string };
}

/** The storefront's built-in copy — copied verbatim from the hardcoded strings
 *  in Home.tsx / Ticker.tsx / Footer.tsx / Lookbook.tsx. With no admin
 *  overrides the site renders byte-identically to today. */
export const DEFAULT_CONTENT: SiteContent = {
  hero: {
    imageUrl: null,
    focusX: 50,
    focusY: 50,
    seasonLabel: 'Spring / Summer 2026',
    eyebrow: 'The Verdant Edit · Indo-Western Couture',
    title: 'Tanvi Agnihotry',
    titleItalic: 'heritage, made to move.',
    ctaPrimary: 'Discover the Collection',
    ctaSecondary: 'Book an Appointment',
    edgeLeft: 'Made to Order — India',
    edgeRight: 'Vol. 01 / 24 Looks',
  },
  featured: {
    imageUrl: null,
    focusX: 50,
    focusY: 50,
    eyebrow: 'The New Collection',
    title: 'Rang',
    titleEm: 'Mehfil',
    copy: 'Hand-embroidered indo-western silhouettes in moss, sage and pistachio — cut for the way the modern Indian woman actually moves. Each piece made to order, each made to last.',
    ctaLabel: 'Explore the Edit',
    ctaHref: '/collection',
  },
  // The four unique lines; the marquee track prints the list twice to loop.
  marquee: {
    items: ['Made to Order', '— hand embroidered —', 'The Verdant Edit', '— Spring 2026 —'],
  },
  trust: {
    items: [
      { title: 'Made to Order', detail: 'Crafted on commission · 4–6 weeks' },
      { title: 'Complimentary Fittings', detail: 'Virtual or in-studio, Mumbai' },
      { title: 'Worldwide Shipping', detail: 'Insured & tracked, on the house' },
    ],
  },
  lookbookCover: {
    imageUrl: null,
    focusX: 50,
    focusY: 50,
    masthead: 'The Edit',
    subItems: ['Volume 01', 'Spring 2026', '32 Looks'],
  },
  lookbook: {
    // Looks 02, 03, 05, 06 and 07 are images only today — no caption copy.
    looks: [
      {
        imageUrl: null,
        focusX: 50,
        focusY: 50,
        lookNo: 'Look 01',
        title: 'The garden, after rain.',
        copy: 'Sage sequin jacket lehenga with a hand-draped dupatta. Structured shoulder, fluid hem.',
        ctaHref: '/collection/lehenga',
      },
      { imageUrl: null, focusX: 50, focusY: 50, lookNo: 'Look 02', title: '', copy: '', ctaHref: '' },
      { imageUrl: null, focusX: 50, focusY: 50, lookNo: 'Look 03', title: '', copy: '', ctaHref: '' },
      {
        imageUrl: null,
        focusX: 50,
        focusY: 50,
        lookNo: 'Look 04',
        title: 'Moss & mirror.',
        copy: 'A tissue draped gown caught with mirror-work — light moving as you do.',
        ctaHref: '/collection/kaftan',
      },
      { imageUrl: null, focusX: 50, focusY: 50, lookNo: 'Look 05', title: '', copy: '', ctaHref: '' },
      { imageUrl: null, focusX: 50, focusY: 50, lookNo: 'Look 06', title: '', copy: '', ctaHref: '' },
      { imageUrl: null, focusX: 50, focusY: 50, lookNo: 'Look 07', title: '', copy: '', ctaHref: '' },
    ],
    quote: '"She does not choose between heritage and the present. She wears both, at once."',
    quoteCite: '— The Verdant Edit',
  },
  // The three real messages; the ticker track adds the '·' separators.
  ticker: {
    items: [
      'Complimentary Made-to-Order Consultation',
      'Worldwide Shipping',
      'Spring 2026 — The Verdant Edit',
    ],
  },
  footer: {
    blurb:
      'Indo-western couture, made to order in India. Crafting timeless pieces for the modern Indian woman since 2026.',
    // Real handles (mirrored from the Contact page). Pinterest has no account
    // yet — empty means the link simply doesn't render.
    instagramUrl: 'https://instagram.com/tanviagnihotrylabel',
    pinterestUrl: '',
    whatsappUrl: 'https://wa.me/918118892523',
  },
};

const EMPTY_LOOK: Look = {
  imageUrl: null, focusX: 50, focusY: 50, lookNo: '', title: '', copy: '', ctaHref: '',
};

/* ---- Scrolling tracks (ticker, marquee) ---- */

/**
 * Both scrollers loop by printing their list twice and translating the track
 * -50%, which only reads as a seamless loop while *one* copy is wide enough to
 * span the band. Cut the list down to a single short message and the strip runs
 * mostly empty, with a visible jump each time it wraps.
 *
 * So repeat the list until its copy is at least as long as the run the
 * component was designed around. `minChars` is the component's own default copy
 * (see the two constants below), which makes the defaults — and anything of
 * comparable length — repeat nothing at all.
 */
export function fillTrack(items: string[], minChars: number): string[] {
  const chars = items.join('').length;
  if (chars === 0) return [...items];
  const copies = Math.max(1, Math.ceil(minChars / chars));
  return Array.from({ length: copies }, () => items).flat();
}

/** The band each scroller was drawn for, measured in its own built-in copy. */
export const TICKER_MIN_CHARS = DEFAULT_CONTENT.ticker.items.join('').length;
export const MARQUEE_MIN_CHARS = DEFAULT_CONTENT.marquee.items.join('').length;

/** A plain object, or {} for anything else (null, arrays, scalars, junk). */
function obj(v: unknown): Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
    ? (v as Record<string, unknown>)
    : {};
}

function mergeStr(v: unknown, d: string): string {
  return typeof v === 'string' && v.trim() !== '' ? v : d;
}

function mergeImg(v: unknown, d: string | null): string | null {
  return typeof v === 'string' && v.trim() !== '' ? v : d;
}

/** Focal points: a finite number clamped to 0–100 wins; junk falls back. */
function mergeNum(v: unknown, d: number): number {
  return typeof v === 'number' && Number.isFinite(v) ? Math.min(100, Math.max(0, v)) : d;
}

/** String lists are replaced wholesale — a non-empty list wins, anything else
 *  (missing, empty, not an array, all-blank) falls back to the default. */
function mergeStrList(v: unknown, d: string[]): string[] {
  if (!Array.isArray(v)) return [...d];
  const items = v.filter((x): x is string => typeof x === 'string' && x.trim() !== '');
  return items.length > 0 ? items : [...d];
}

function mergeTrustItem(v: unknown, d: TrustItem): TrustItem {
  const o = obj(v);
  return { title: mergeStr(o.title, d.title), detail: mergeStr(o.detail, d.detail) };
}

function mergeLook(v: unknown, d: Look): Look {
  const o = obj(v);
  return {
    imageUrl: mergeImg(o.imageUrl, d.imageUrl),
    focusX: mergeNum(o.focusX, d.focusX),
    focusY: mergeNum(o.focusY, d.focusY),
    lookNo: mergeStr(o.lookNo, d.lookNo),
    title: mergeStr(o.title, d.title),
    copy: mergeStr(o.copy, d.copy),
    ctaHref: mergeStr(o.ctaHref, d.ctaHref),
  };
}

/** Trust items are always exactly three — merged per index over the defaults. */
function mergeTrustItems(v: unknown, d: TrustItem[]): TrustItem[] {
  const arr = Array.isArray(v) ? v : [];
  return d.map((def, i) => mergeTrustItem(arr[i], def));
}

/** Looks merge per index over the default at that index; anything past the
 *  built-in seven is kept as sent (with blanks for the fields it omits). */
function mergeLooks(v: unknown, d: Look[]): Look[] {
  const arr = Array.isArray(v) ? v : [];
  const length = Math.max(d.length, arr.length);
  const looks: Look[] = [];
  for (let i = 0; i < length; i += 1) {
    looks.push(mergeLook(arr[i], d[i] ?? EMPTY_LOOK));
  }
  return looks;
}

/** Layer the admin's overrides over DEFAULT_CONTENT. Unknown sections, junk
 *  values and blank strings are ignored — the default always wins. */
export function mergeContent(sections: Record<string, unknown>): SiteContent {
  const s = obj(sections);
  const d = DEFAULT_CONTENT;

  const hero = obj(s.hero);
  const featured = obj(s.featured);
  const marquee = obj(s.marquee);
  const trust = obj(s.trust);
  const lookbookCover = obj(s.lookbookCover);
  const lookbook = obj(s.lookbook);
  const ticker = obj(s.ticker);
  const footer = obj(s.footer);

  return {
    hero: {
      imageUrl: mergeImg(hero.imageUrl, d.hero.imageUrl),
      focusX: mergeNum(hero.focusX, d.hero.focusX),
      focusY: mergeNum(hero.focusY, d.hero.focusY),
      seasonLabel: mergeStr(hero.seasonLabel, d.hero.seasonLabel),
      eyebrow: mergeStr(hero.eyebrow, d.hero.eyebrow),
      title: mergeStr(hero.title, d.hero.title),
      titleItalic: mergeStr(hero.titleItalic, d.hero.titleItalic),
      ctaPrimary: mergeStr(hero.ctaPrimary, d.hero.ctaPrimary),
      ctaSecondary: mergeStr(hero.ctaSecondary, d.hero.ctaSecondary),
      edgeLeft: mergeStr(hero.edgeLeft, d.hero.edgeLeft),
      edgeRight: mergeStr(hero.edgeRight, d.hero.edgeRight),
    },
    featured: {
      imageUrl: mergeImg(featured.imageUrl, d.featured.imageUrl),
      focusX: mergeNum(featured.focusX, d.featured.focusX),
      focusY: mergeNum(featured.focusY, d.featured.focusY),
      eyebrow: mergeStr(featured.eyebrow, d.featured.eyebrow),
      title: mergeStr(featured.title, d.featured.title),
      titleEm: mergeStr(featured.titleEm, d.featured.titleEm),
      copy: mergeStr(featured.copy, d.featured.copy),
      ctaLabel: mergeStr(featured.ctaLabel, d.featured.ctaLabel),
      ctaHref: mergeStr(featured.ctaHref, d.featured.ctaHref),
    },
    marquee: { items: mergeStrList(marquee.items, d.marquee.items) },
    trust: { items: mergeTrustItems(trust.items, d.trust.items) },
    lookbookCover: {
      imageUrl: mergeImg(lookbookCover.imageUrl, d.lookbookCover.imageUrl),
      focusX: mergeNum(lookbookCover.focusX, d.lookbookCover.focusX),
      focusY: mergeNum(lookbookCover.focusY, d.lookbookCover.focusY),
      masthead: mergeStr(lookbookCover.masthead, d.lookbookCover.masthead),
      subItems: mergeStrList(lookbookCover.subItems, d.lookbookCover.subItems),
    },
    lookbook: {
      looks: mergeLooks(lookbook.looks, d.lookbook.looks),
      quote: mergeStr(lookbook.quote, d.lookbook.quote),
      quoteCite: mergeStr(lookbook.quoteCite, d.lookbook.quoteCite),
    },
    ticker: { items: mergeStrList(ticker.items, d.ticker.items) },
    footer: {
      blurb: mergeStr(footer.blurb, d.footer.blurb),
      instagramUrl: mergeStr(footer.instagramUrl, d.footer.instagramUrl),
      pinterestUrl: mergeStr(footer.pinterestUrl, d.footer.pinterestUrl),
      whatsappUrl: mergeStr(footer.whatsappUrl, d.footer.whatsappUrl),
    },
  };
}

const Ctx = createContext<SiteContent>(DEFAULT_CONTENT);

export function SiteContentProvider({ children }: { children: ReactNode }) {
  const [content, setContent] = useState<SiteContent>(DEFAULT_CONTENT);
  useEffect(() => {
    let cancelled = false;
    api
      .get<{ sections: Record<string, unknown> }>('/api/content')
      .then((data) => {
        if (!cancelled) setContent(mergeContent(data?.sections ?? {}));
      })
      // Fetch failure → defaults; never a broken page. Silent in production,
      // but visible while developing so a broken /api/content isn't mistaken
      // for "the admin hasn't customised anything yet".
      .catch((err: unknown) => {
        if (import.meta.env.DEV) console.warn('site content fetch failed', err);
      });
    return () => {
      cancelled = true;
    };
  }, []);
  return <Ctx.Provider value={content}>{children}</Ctx.Provider>;
}

export function useSiteContent(): SiteContent {
  return useContext(Ctx);
}
