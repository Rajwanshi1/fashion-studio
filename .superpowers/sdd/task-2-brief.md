# Task 2: Frontend analytics module — `frontend/src/lib/analytics.ts` + PageTracking

Client side of first-party analytics. Backend `POST /api/track` already exists (batch: `{visitorId, sessionId, userId?, events: [{type, path?, productId?, props?}]}`, max 20 events, uuids validated, 204 response). This task builds the identity + queue + flush machinery and pageview tracking. Instrumentation of other events is a LATER task — only `session_start` and `page_view` fire after this task.

## Philosophy template

Read `socials/src/track.ts` first — beacon philosophy to copy: never throw, all storage access in try/catch, fire-and-forget `.catch(() => {})`, module-level constants exported for tests.

## `frontend/src/lib/analytics.ts` (new)

Import `API_BASE`? — `frontend/src/lib/api.ts` keeps it private; export it from api.ts or re-derive locally the same way (`import.meta.env.VITE_API_URL ?? 'http://localhost:3001'`). Prefer exporting `API_BASE` from api.ts (one-line change). Do NOT use `api.post` (it throws and attaches auth headers; the beacon must be silent).

**Event types**: export a string-union `EventType` matching the backend whitelist (20 types): session_start, page_view, product_view, add_to_cart, remove_from_cart, checkout_start, checkout_step, payment_result, order_placed, search, filter_apply, sort_change, wishlist_add, wishlist_remove, variant_select, color_select, signup, login, newsletter_signup, contact_submit.

**Identity:**
- `ta.visitor` (localStorage): permanent UUID, created on first use.
- `ta.session` (localStorage): JSON `{id: string, ts: number}` — last-activity timestamp.
- On every `track()` call: read session; if missing or `Date.now() - ts > 30 * 60 * 1000` → generate new session id AND enqueue a `session_start` event BEFORE the triggering event (same batch), with props `{referrer: document.referrer || null, utmSource, utmMedium, utmCampaign, landing: location.pathname}` (utm* parsed from `location.search`, null when absent); always rewrite `{id, ts: Date.now()}`. Synchronous read-modify-write → StrictMode double-invocation cannot double-rotate.
- UUIDs: `crypto.randomUUID()` with a `Math.random`-based v4 fallback.
- Storage blocked (Safari private mode etc.): every access in try/catch; fall back to module-level in-memory ids for the page load. Never throw, never block rendering.
- `userId`: read at FLUSH time from `localStorage['ta.auth']` → `JSON.parse(raw).user?.id ?? null` (try/catch → null).

**Queue + flush:**
- `export function track(type: EventType, data?: { productId?: string; props?: Record<string, unknown> }): void` — pushes `{type, path: location.pathname, productId?, props?}`; arms a 10s timer (`FLUSH_MS = 10_000`) if not armed; queue length ≥ `MAX_BATCH = 20` → flush immediately.
- `flush()`: drain up to 20 events → `{visitorId, sessionId, userId, events}` → `fetch(`${API_BASE}/api/track`, {method:'POST', headers:{'content-type':'application/json'}, body, keepalive: true}).catch(() => {})`. If more than 20 queued, re-arm for the remainder.
- Module-level listeners registered once (guard flag): `pagehide` and `visibilitychange` (when `document.visibilityState === 'hidden'`) → `flushNow()`: try `navigator.sendBeacon(url, new Blob([json], {type:'application/json'}))`; when sendBeacon is absent, throws, or returns false → fetch keepalive fallback. Timer flush can use plain fetch.
- Export internals needed for tests (endpoint constant, maybe a `_reset()` test helper following the repo's conventions if one is needed — check how socials/track.test.ts handles module state).

**Pageview hook:**
- `export function usePageTracking(): void` — `useLocation()` effect; dedup on `location.key` in a module variable (identical across StrictMode double-invoke; differs on A→B→A navigation); fires `track('page_view')`.
- In `frontend/src/App.tsx`: add `function PageTracking() { usePageTracking(); return null; }` and render `<PageTracking />` right after `<ScrollToTop />` in `AppRoutes` (line ~52).

## Tests — `frontend/src/__tests__/analytics.test.ts` (vitest, jsdom, fake timers, mocked fetch)

Check how existing frontend tests are set up (`frontend/src/__tests__/`, vitest config) and follow conventions.

- two `track()` calls → zero fetches until 10s advance → exactly one POST with both events + envelope (visitorId/sessionId are uuids).
- 20 queued → immediate flush without timer advance.
- Session rotation: track → advance 31 min → track → new sessionId AND a `session_start` event enqueued; NOT rotated after only 5 min.
- Storage blocked: `localStorage.getItem`/`setItem` throwing → no exception, events still POSTed with in-memory uuids.
- `pagehide` dispatch → `navigator.sendBeacon` used when present; sendBeacon returning false → fetch keepalive fallback fires.
- If existing provider/page tests become noisy from stray `/api/track` fetches, add a stub in the frontend test setup file so output stays pristine (only session_start/page_view fire after this task; check whether it's actually needed before adding).

## Acceptance

- `npm test` green in `frontend/` (whole suite).
- TypeScript build clean (`npm run build` or `tsc --noEmit` per package convention).
- No visual/behavioral change to the storefront beyond network beacons.
