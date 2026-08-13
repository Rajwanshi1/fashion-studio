import { useEffect } from 'react';

const BASE = 'Tanvi Agnihotry';
const DEFAULT_TITLE = `${BASE} — Hand-embroidered, made to order · Jaipur`;

/** Per-route document.title (the SPA ships one static <title> for every URL).
 *  Pass undefined while data loads — the previous title holds until the real
 *  one is known; '' asks for the site-wide default. */
export function usePageTitle(title?: string) {
  useEffect(() => {
    if (title === undefined) return;
    document.title = title ? `${title} — ${BASE}` : DEFAULT_TITLE;
  }, [title]);
}

/** Marks the current view noindex (the CDN answers every path 200, so a
 *  rendered 404 is otherwise indexable). Removed on unmount. */
export function useNoIndex() {
  useEffect(() => {
    const meta = document.createElement('meta');
    meta.name = 'robots';
    meta.content = 'noindex';
    document.head.appendChild(meta);
    return () => {
      document.head.removeChild(meta);
    };
  }, []);
}
