// Scan-source beacon for the link-in-bio page. QR codes point at
// `/?src=<source>` (or `?utm_source=<source>` for anything using standard
// UTM tagging); this fires a one-shot, fire-and-forget POST so the boutique
// can see which physical touchpoint (store window, postcard, …) drove the
// visit, then scrubs the query param so the URL looks clean if shared.

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
const ENDPOINT = `${API_BASE}/api/socials/scan`;
const STORAGE_KEY = 'ta-scan-logged';

// Module-level guard: belt-and-suspenders alongside sessionStorage so a
// double-invocation within the same page load (e.g. React StrictMode calling
// effects twice) can never fire the beacon twice either.
let sent = false;

export function trackScan(): void {
  // This runs from main.tsx before createRoot. sessionStorage/URL access can
  // throw a SecurityError in some environments (e.g. Chromium "Block all
  // cookies", certain embedded webviews) — tracking is optional, rendering is
  // not, so any failure here must never propagate and blank the page.
  try {
    if (typeof window === 'undefined' || sent) return;
    if (sessionStorage.getItem(STORAGE_KEY)) return;

    const url = new URL(window.location.href);
    const source = url.searchParams.get('src') ?? url.searchParams.get('utm_source');
    if (!source) return;

    sent = true;
    sessionStorage.setItem(STORAGE_KEY, '1');

    fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
      keepalive: true,
    }).catch(() => {
      // Fire-and-forget: a dead network must never break the page.
    });

    url.searchParams.delete('src');
    url.searchParams.delete('utm_source');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Storage/URL access blocked — degrade silently, rendering must proceed.
  }
}
