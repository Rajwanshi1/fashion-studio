# Task 3 Report — Instrument storefront events

## Fix section (post-review)

The task reviewer found two Important issues after the initial pass. Both are fixed, both are now covered by a dedicated `<StrictMode>`-wrapped regression test, and both tests were verified to actually catch the bug (temporarily reverted the fix, watched the test fail with the exact symptom described, then restored the fix and watched it pass again).

### Finding 1 — filter_apply guard inverted under StrictMode (`frontend/src/pages/Collection.tsx`)

**Bug:** `filterInitialRef` was a one-shot boolean. StrictMode double-invokes the mount effect: invocation 1 saw `true`, flipped it to `false`, returned; invocation 2 then saw `false` and armed a real 500ms timer, firing a spurious `filter_apply` with the *initial* filter values on every Collection page load in dev.

**Fix:** replaced the boolean with a value-based snapshot ref — `lastFilterRef = useRef({ colors, priceMax })`, initialized to the actual initial values. The effect now compares current `colors`/`priceMax` against the snapshot and bails if unchanged; both StrictMode invocations see "unchanged" (since neither invocation has mutated the snapshot) and produce no event. The snapshot only advances inside the `setTimeout` callback, at the moment an event actually fires — so rapid changes within the debounce window still collapse to one fire, and the mount-time false-positive is gone. Same technique as the `product_view` slug ref.

**New test:** `frontend/src/__tests__/collection-tracking.test.tsx` — renders `<Collection>` inside `<StrictMode>` via a minimal `MemoryRouter`/`Providers`/`Routes` harness (mirrors `product-tracking.test.tsx`), mocks `track`, waits past the 500ms debounce window, and asserts zero `filter_apply` calls fired from mounting alone. Verified this test fails (`expected length +0, got 1`) against the reverted (buggy) code, then passes against the fix.

### Finding 2 — wishlist toggle() double-fires (`frontend/src/lib/wishlist.tsx`)

**Bug:** `toggle()` computed `exists` and called `track()` inside the `setIds` functional updater. React 18 StrictMode double-invokes functional updaters passed to `setState` (every call, not just on mount) as a purity check, so every click fired the wishlist event twice in dev. The existing `api.del`/`api.put` calls in that same updater already tolerated double-invocation (idempotent), but a countable analytics event does not — it would corrupt wishlist funnel counts.

**Fix:** `exists` is now read from the current `ids` state variable *outside* the updater; `track()` and the `api.del`/`api.put` call happen exactly once per invocation of `toggle`, and `setIds` is left as a pure function of `prev` with no side effects inside it (so it's safe regardless of how many times React re-invokes it). `toggle`'s `useCallback` deps changed from `[token]` to `[ids, token]` since it now reads `ids` directly. Added an inline comment explaining why (per reviewer's suggestion — `remove()` was already side-effect-free inside its updater, so no comment was needed there and it was left unchanged).

**New test:** `frontend/src/__tests__/wishlist-tracking.test.tsx` — renders a minimal `<StrictMode>`-wrapped harness using `useWishlist().toggle`, mocks `track`, clicks once and asserts exactly one `wishlist_add`, then clicks again and asserts exactly one `wishlist_remove`. Verified both assertions fail (`expected length 1, got 2`) against the reverted (buggy) code, then pass against the fix.

### Re-run: covering tests + full suite + typecheck

```
npx tsc --noEmit
```
→ clean, no output.

```
npx vitest run src/__tests__/collection-tracking.test.tsx
```
→ 1 file, 1 test, passed (verified fails on buggy code, passes on fix — see above).

```
npx vitest run src/__tests__/wishlist-tracking.test.tsx
```
→ 1 file, 2 tests, passed (verified fails on buggy code, passes on fix — see above).

```
npx vitest run
```
→ **15 test files, 43 tests, all passing** (was 13 files / 40 tests before this fix round — the +2 files/+3 tests are the two new regression test files). Ran 3× total across the fix cycle (once right after each individual fix, once for the full combined suite, plus 2 extra repeats for flakiness) — stable every time, ~2.6–2.7s per run. Output remains pristine: only the pre-existing React Router v7 future-flag warnings, no new console noise, no act() warnings.

### Files changed in this fix round

- `frontend/src/pages/Collection.tsx` — `filter_apply` guard made value-based
- `frontend/src/lib/wishlist.tsx` — `toggle()` reworked so `track()` fires outside the `setIds` updater
- `frontend/src/__tests__/collection-tracking.test.tsx` — new, StrictMode regression test
- `frontend/src/__tests__/wishlist-tracking.test.tsx` — new, StrictMode regression test

No other files touched in this round.

---

## Table row → file:line wired

| Event | File:line | Notes |
|---|---|---|
| `product_view` | `frontend/src/pages/Product.tsx:66-72` (guard ref declared L48) | `lastTrackedSlugRef` guard vs. StrictMode double effect; fires in the `.then()` success branch right after `setProduct(detail)` |
| `variant_select` | `frontend/src/pages/Product.tsx:242-246` | size button `onClick` |
| `color_select` | `frontend/src/pages/Product.tsx:222-226` | color swatch `onClick` |
| `add_to_cart` | `frontend/src/lib/cart.tsx:61-64` | one line in `add()`, covers all 3 call sites (`Product.tsx`, `Home.tsx` quickAdd, `Wishlist.tsx`) |
| `remove_from_cart` | `frontend/src/lib/cart.tsx:77` (`setQty` qty<1 branch) and `:86` (`remove`) | props `{variantId}` only, both sites |
| `checkout_start` | `frontend/src/pages/Checkout.tsx:50-56` | new mount effect, `checkoutStartedRef` guard, only fires when `items.length > 0` |
| `checkout_step` (`info_submitted`) | `frontend/src/pages/Checkout.tsx:105` | in `placeOrder`, after the existing guard |
| `checkout_step` (`payment_opened`) | `frontend/src/pages/Checkout.tsx:85` | in `startPayment`, right after `setPayment(pay)` |
| `checkout_step` (`method_selected`) | `frontend/src/pages/Checkout.tsx:444-447, 487-490, 500-503` | card/upi/cod `opt-row` onClicks |
| `payment_result` (`success`) | `frontend/src/pages/Checkout.tsx:115` | in `onPay`, after confirm succeeds |
| `payment_result` (`failure`) | `frontend/src/pages/Checkout.tsx:133` (`onPay` catch) and `:149` (`onFail`) | |
| `order_placed` | `frontend/src/pages/Checkout.tsx:116-131` | fires before `clear()` (confirmed in diff — `clear()` is the line right after) |
| `search` | `frontend/src/pages/Search.tsx:43-46` | in the debounced fetch's `.then()`; `lastTrackedQueryRef` dedupes consecutive identical queries |
| `filter_apply` | `frontend/src/pages/Collection.tsx:101-115` | new effect watching `[colors, priceMax]`; `filterInitialRef` skips the mount run; 500ms debounce via `setTimeout`/cleanup |
| `sort_change` | `frontend/src/pages/Collection.tsx:127` | in `setSort` |
| `wishlist_add` / `wishlist_remove` | `frontend/src/lib/wishlist.tsx:100` (`remove` → always `wishlist_remove`) and `:111` (`toggle` → `exists ? wishlist_remove : wishlist_add`) | |
| `signup` | `frontend/src/lib/auth.tsx:76` | `register` success |
| `login` | `frontend/src/lib/auth.tsx:58` (`login`, method `password`) and `:64` (`loginWithGoogle`, method `google`) | |
| `newsletter_signup` | `frontend/src/pages/Home.tsx:253` | `NewsletterSection` form `onSubmit`, no props |
| `contact_submit` | `frontend/src/pages/Contact.tsx:15` | `onSubmit`, props `{tab}` |

All 18 rows wired. Cross-checked call sites of `cart.add`, `wishlist.toggle/remove`, and `auth.login/loginWithGoogle/register` across the whole `frontend/src` tree to confirm the provider-level instrumentation covers every UI entry point (Product.tsx, Home.tsx, Wishlist.tsx for cart; ProductCard.tsx, Product.tsx, Wishlist.tsx for wishlist; Login.tsx for auth) — no call sites were missed.

Backend `EVENT_TYPES` in `backend/src/routes/analytics.routes.ts` already lists all 20 types (including `session_start`/`page_view` from Task 2) — no backend changes needed or made.

## Tests

Commands run:
- `npx tsc --noEmit` — clean, no output.
- `npx vitest run` — **13 test files, 40 tests, all passing**, run 4× in a row for flakiness (timer-based tests), stable every time (~2.6–2.7s each run).

New/changed test files:
- `frontend/src/__tests__/product-tracking.test.tsx` (new) — renders `<Product>` inside `<StrictMode>` via a minimal `MemoryRouter`/`Providers`/`Routes` harness (same pattern as `page-tracking.test.tsx`), mocks `../lib/analytics`'s `track` export, and asserts `product_view` fires exactly once (not twice) despite StrictMode double-invoking the load effect, with the exact `{productId, props:{slug,name,price}}` shape.
- `frontend/src/__tests__/search.test.tsx` (new) — mocks `track`, uses fake timers, types a query, asserts one `search` call with `{props:{query,results}}`; then re-types to the same trimmed query and asserts the dedupe ref suppresses a second `search` call.
- `frontend/src/__tests__/plp.test.tsx` (extended) — added `vi.mock('../lib/analytics', ...)` file-wide (harmless to the 3 pre-existing tests, which don't touch tracking); added a `sort_change` assertion to the existing "refetches with the chosen sort" test; added a new test for `filter_apply` covering skip-initial-render, 500ms debounce collapsing two rapid color-swatch clicks into one call, and the exact `{props:{category,colors,priceMax}}` payload.

I deliberately mocked the `analytics` module's `track` export (partial mock via `importOriginal` + override) rather than asserting on `/api/track` fetch calls for these three guard tests — the batching/flush network mechanics are already fully covered by `analytics.test.ts`; these tests are about the guard/dedupe logic only, per the brief.

### Existing-suite / noise check
Ran the full pre-existing suite (37 tests) before making any changes to establish a clean baseline, then re-ran after wiring (40 tests: +3 new focused tests). Output stayed pristine — only the pre-existing React Router future-flag warnings appear, no new console noise.

Specifically checked `cart.test.tsx` (uses `renderHook(useCart)` directly, no fetch mock at all) and `nav.test.tsx` (renders `<Providers>` without `mockFetch`) — both now invoke `track()` via `add`/`setQty`/`remove`. This does **not** produce fetch noise because `track()` only calls `fetch` when the 10s `FLUSH_MS` timer fires or the 20-event `MAX_BATCH` is hit; neither test file's runtime (~20ms) approaches either threshold, and the whole suite finishes in ~2.6s, well under the timer window — so the module-level `armTimer()` never actually invokes the real (unmocked) global `fetch` during any test run. This matches the Task-2 implementer's design intent (fire-and-forget, batched, short-circuited by test runtime) — verified rather than needing a new stub.

Initially, `search.test.tsx` produced a React "not wrapped in act(...)" warning because `vi.advanceTimersByTimeAsync` resolved the debounced fetch's `.then()` (which calls `setResults`/`setTotal`/etc.) outside an `act()` boundary. Fixed by wrapping both timer-advance calls in `act(() => vi.advanceTimersByTimeAsync(...))`. Re-verified clean after the fix.

## Files changed

- `frontend/src/lib/cart.tsx` — `add_to_cart`, `remove_from_cart` (×2 sites)
- `frontend/src/lib/wishlist.tsx` — `wishlist_add`/`wishlist_remove`
- `frontend/src/lib/auth.tsx` — `signup`, `login` (×2 methods)
- `frontend/src/pages/Product.tsx` — `product_view`, `variant_select`, `color_select`
- `frontend/src/pages/Checkout.tsx` — `checkout_start`, `checkout_step` (×3), `payment_result` (×2), `order_placed`
- `frontend/src/pages/Search.tsx` — `search`
- `frontend/src/pages/Collection.tsx` — `filter_apply`, `sort_change`
- `frontend/src/pages/Home.tsx` — `newsletter_signup`
- `frontend/src/pages/Contact.tsx` — `contact_submit`
- `frontend/src/__tests__/plp.test.tsx` — extended (sort_change assertion + new filter_apply test)
- `frontend/src/__tests__/product-tracking.test.tsx` — new
- `frontend/src/__tests__/search.test.tsx` — new

No backend files touched (Task 1's `EVENT_TYPES` already covers every type this task uses).

## Self-review

**Completeness**
- Every row of the table wired — see mapping above.
- `order_placed` fires before `clear()` — confirmed in the `onPay` diff (track calls precede `clear()` by 3 lines, same try block, no intervening await).
- StrictMode/skip-initial guards present exactly where the brief calls for them: `product_view` (`lastTrackedSlugRef`), `checkout_start` (`checkoutStartedRef`), `filter_apply` (`filterInitialRef` + 500ms debounce).

**Discipline**
- No behavior changes: every insertion is a `track()` call placed beside existing logic, or (for `setQty`/`toggle`) a single new `if`/ternary-branch condition guarding *only* the tracking call, never altering the pre-existing state-mutation logic.
- No extra events invented; no call site skipped or substituted.
- Prop shapes match the brief verbatim in every case, including which fields are top-level (`productId`, wishlist's bare `{productId: id}`) vs. nested under `props`.
- Onclick handlers that were previously one-line arrows became block-body arrows (2 statements) where a track call needed to be added — this is a shape change to the handler literal, not a logic/behavior change; the original state-setting call is untouched and unconditional.

**~~One accepted latent risk (inherited, not introduced): `wishlist.tsx`'s `toggle()` computes `exists` and calls `track()` inside the `setIds` functional updater... this could double-fire `wishlist_add`/`wishlist_remove`... no additional guard was added.~~**

**Superseded — see "Fix section" at the top of this report.** The task reviewer correctly flagged this "accepted risk" as an actual bug (Finding 2): a countable analytics event is not the same tolerance class as an idempotent `api.del`/`put` call, and it does double-fire under StrictMode on every click, not just theoretically. Fixed by reading `exists` from `ids` outside the updater. The reviewer also caught a second bug this original self-review missed entirely: the `filter_apply` skip-initial guard (`filterInitialRef` boolean) was itself inverted by StrictMode's mount double-invoke, firing a spurious event on every Collection page load in dev (Finding 1) — this was not caught at the time because the covering test used `renderApp()`, which doesn't wrap in `<StrictMode>`. Both are now fixed and covered by dedicated StrictMode-wrapped regression tests (see fix section).

**Testing (original pass, superseded by the re-run above)**
- `npm test` (`vitest run`) green: 13 files / 40 tests, 4 consecutive runs, no flakiness observed.
- TypeScript clean (`tsc --noEmit`).
- Output pristine: no new console noise; the only stderr lines are the pre-existing React Router v7 future-flag warnings that were already present before this task.

Current state (post-fix): 15 files / 43 tests, all green — see "Fix section" at the top for the up-to-date test run.
