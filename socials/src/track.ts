// Scan-source beacon for the link-in-bio page. QR codes point at
// `/?src=<source>` (or `?utm_source=<source>` for anything using standard
// UTM tagging); this fires a one-shot, fire-and-forget POST so the boutique
// can see which physical touchpoint (store window, postcard, …) drove the
// visit, then scrubs the query param so the URL looks clean if shared.
// The source is kept in sessionStorage so outbound link clicks (trackClick)
// can be attributed back to the QR that brought the visitor.

const API_BASE: string =
  (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:3001';
const SCAN_ENDPOINT = `${API_BASE}/api/socials/scan`;
const CLICK_ENDPOINT = `${API_BASE}/api/socials/click`;
const STORAGE_KEY = 'ta-scan-logged';
const SOURCE_KEY = 'ta-scan-source';

// Module-level guard: belt-and-suspenders alongside sessionStorage so a
// double-invocation within the same page load (e.g. React StrictMode calling
// effects twice) can never fire the beacon twice either.
let sent = false;

function beacon(endpoint: string, body: unknown): void {
  fetch(endpoint, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify(body),
    keepalive: true,
  }).catch(() => {
    // Fire-and-forget: a dead network must never break the page.
  });
}

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
    sessionStorage.setItem(SOURCE_KEY, source);

    beacon(SCAN_ENDPOINT, { source });

    url.searchParams.delete('src');
    url.searchParams.delete('utm_source');
    window.history.replaceState({}, '', `${url.pathname}${url.search}${url.hash}`);
  } catch {
    // Storage/URL access blocked — degrade silently, rendering must proceed.
  }
}

/** Fire-and-forget beacon for an outbound link click, attributed to the scan
 *  source that brought this visitor when one is known. Every click counts —
 *  no once-per-session guard. Never throws: the navigation must proceed. */
export function trackClick(link: string): void {
  try {
    if (typeof window === 'undefined') return;

    let source: string | null = null;
    try {
      source = sessionStorage.getItem(SOURCE_KEY);
    } catch {
      // Storage blocked — the click still counts, just unattributed.
    }

    beacon(CLICK_ENDPOINT, source ? { link, source } : { link });
  } catch {
    // Tracking is optional; the link click must never break.
  }
}
