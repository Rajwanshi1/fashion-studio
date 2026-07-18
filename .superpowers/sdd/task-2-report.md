# Task 2: Frontend analytics module — Report

## What I implemented

**`frontend/src/lib/analytics.ts` (new)** — identity + queue + flush + pageview hook, following the `socials/src/track.ts` philosophy (never throw, all storage access in try/catch, fire-and-forget `.catch(() => {})`, module-level constants exported for tests).

- **Identity**: `ta.visitor` (permanent UUID) and `ta.session` (`{id, ts}`, JSON) in `localStorage`. Every `track()` call synchronously reads `ta.session`, rotates (new `crypto.randomUUID()`, with a `Math.random` v4 fallback) when missing or idle >30 min, and always rewrites `{id, ts: Date.now()}`. The read-modify-write is fully synchronous so a StrictMode double-invocation in the same tick can't rotate twice. Both storage keys fall back to module-level in-memory ids (scoped to the page load) if `localStorage` throws.
- **`userId`**: read fresh at flush time from `localStorage['ta.auth']` → `JSON.parse(raw).user?.id ?? null`, try/catch → `null` (matches the shape `AuthProvider` already writes).
- **Queue + flush**: `track(type, data?)` pushes `{type, path: location.pathname, productId?, props?}`, arms a 10s timer (`FLUSH_MS = 10_000`) if not already armed, and flushes immediately once the queue hits `MAX_BATCH = 20`. Timer-driven `flush()` uses plain `fetch(..., {keepalive: true}).catch(() => {})`. `pagehide` and `visibilitychange` (tab hidden) call `flushNow()`, which tries `navigator.sendBeacon` first and falls back to `fetch` keepalive when `sendBeacon` is absent, throws, or returns `false`. Both paths re-arm the timer for any remainder beyond 20.
- Session rotation enqueues `session_start` **before** the triggering event, in the same batch, with `props: {referrer: document.referrer || null, utmSource, utmMedium, utmCampaign, landing: location.pathname}` (utm* parsed from `location.search`, `null` when absent).
- Exported for tests/consumers: `EventType`, `track`, `usePageTracking`, `TRACK_ENDPOINT`, `FLUSH_MS`, `MAX_BATCH`. `flush` stays module-private (nothing outside the module calls it directly).
- **`usePageTracking()`**: a `useLocation()` effect that dedups on `location.key` via a module-level variable — identical across a StrictMode double-invoke (same key), different on any real navigation (even A→B→A, since MemoryRouter/BrowserRouter mint a fresh key per history entry).

**`frontend/src/lib/api.ts`** — no change needed; `API_BASE` was already exported.

**`frontend/src/App.tsx`** — added `import { usePageTracking } from './lib/analytics'`, a `function PageTracking() { usePageTracking(); return null; }`, and `<PageTracking />` rendered right after `<ScrollToTop />` in `AppRoutes`.

## Tests

- `frontend/src/__tests__/analytics.test.ts` (11 tests, no JSX): batching + 10s timer flush with full envelope (uuid visitorId/sessionId, keepalive, content-type header); immediate flush at 20 queued events; session rotation after 31 min idle with a leading `session_start` + unchanged session after only 5 min; utm/referrer capture (present and null-when-absent cases); `localStorage` blocked → no throw, still posts with in-memory uuids; `pagehide` → sendBeacon (present/true, present/false→fetch fallback, absent→fetch fallback); `visibilitychange` (hidden) → flush; rejected fetch swallowed without an unhandled rejection.
- `frontend/src/__tests__/page-tracking.test.tsx` (2 tests, needs JSX so it's a separate `.tsx` file from the brief's `analytics.test.ts`): StrictMode double-invocation of the pageview effect dedupes to exactly one `page_view`; A→B→A navigation (via `useNavigate`) fires three distinct `page_view`s since each history entry gets a new `location.key`.

### Test commands + results

```
npm install                 # fresh worktree, node_modules wasn't present
npx tsc --noEmit            # clean, no errors
npx vitest run              # 11 files, 37 tests passed (3 runs, deterministic)
VITE_API_URL=... npx vite build   # succeeds (build requires this env var in prod mode — pre-existing guard, unrelated to this change)
```

Final summary (repeated 3x for determinism):
```
 Test Files  11 passed (11)
      Tests  37 passed (37)
```
No stray `/api/track` fetches, no unhandled-rejection noise, no extra warnings beyond the pre-existing React Router future-flag notices that were already present in every other test file before this change.

## Files changed

- `frontend/src/lib/analytics.ts` (new)
- `frontend/src/__tests__/analytics.test.ts` (new)
- `frontend/src/__tests__/page-tracking.test.tsx` (new)
- `frontend/src/App.tsx` (+7 lines: import, `PageTracking` component, render call)

## Self-review findings (fixed before reporting)

1. **`document.referrer`/`document.visibilityState` override leak**: a test that set `document.referrer` via `Object.defineProperty` (own-property override) left it in place for the next test, silently breaking a later "no utm/referrer" assertion. Fixed by deleting the own-property override in `afterEach`, restoring jsdom's default getter.
2. **Cross-test dedup-key collision in `page-tracking.test.tsx`**: `usePageTracking`'s `lastPageViewKey` is module-level, and `MemoryRouter` assigns the fixed key `"default"` to every router's *first* history entry regardless of path — so the second test's initial mount looked like a StrictMode repeat of the first test's leftover key, swallowing one `page_view` (test expected 3, got 2). Fixed by using `vi.resetModules()` + a fresh dynamic `import('../lib/analytics')` per test in that file (same convention as `socials/track.test.ts`), which is safe there since that file never exercises the `pagehide`/`visibilitychange` listeners (no risk of stale-listener duplication).
3. Considered whether `analytics.test.ts` itself needed `vi.resetModules()` per test (matching `track.test.ts`) — decided against it: `analytics.ts` registers real `window`/`document` listeners once (guard flag), and repeated `resetModules()` would stack a fresh, un-cleaned-up listener pair per test. Instead that file uses one static import for the whole file; every test fully drains its own queue by the end (timer advance, `MAX_BATCH`, or an explicit `pagehide`/`visibilitychange` dispatch), and `localStorage` is cleared globally after each test (`setupTests.ts`), which is what makes each test's first `track()` call rotate the session deterministically.
4. Checked all pre-existing test files (`checkout`, `login`, `pdp`, `plp`, `nav`, `notfound`, `cart`, `reveal`, `format`) for stray `/api/track` noise now that `AppRoutes` renders `PageTracking` on every `renderApp()` call — none of them assert unfiltered fetch-call counts (they filter by URL substring or spy on unrelated mocks), and the queued page_view's 10s real timer never fires within a test file's sub-second run time, so no stub was added to `setupTests.ts` — confirmed empirically by running the whole suite 3x, output stayed pristine.
5. Un-exported `flush()` (kept `track`, `usePageTracking`, `EventType`, `TRACK_ENDPOINT`, `FLUSH_MS`, `MAX_BATCH` public) since nothing outside the module calls it directly — tightening the public surface to only what's actually used, per the "nothing beyond the brief" discipline check.

## Issues or concerns

None blocking. One judgment call worth flagging: `track()`'s `path` field reads the **global** `window.location.pathname`, which `MemoryRouter`-based tests (used throughout the existing suite) never update — so in those tests the `path` on any incidentally-queued event would read `"/"` regardless of the route under test. This doesn't affect any assertion in this task (our own tests drive `window.location` directly via `history.replaceState`, matching `track.test.ts`'s convention), and it's correct in production since `BrowserRouter` does keep `window.location` in sync — just noting it in case Task 3's instrumentation tests assert on `path` for events fired from `MemoryRouter`-based fixtures.
