# Task 3: Instrument storefront events

`frontend/src/lib/analytics.ts` exists with `track(type, data?)` where `data = { productId?, props? }` — fire-and-forget, never throws. `session_start` and `page_view` already fire automatically. This task wires the remaining ~18 call sites per the table below. Line numbers are approximate — locate by function name.

**Principles:** instrument context providers over call sites (one line in cart.tsx covers all three add-to-cart entry points). Never let tracking change behavior: `track()` calls go beside existing logic, never inside conditions that could alter it. Money values are integer paise (pass through as-is).

| Event | File + location | Call |
|---|---|---|
| `product_view` | `pages/Product.tsx` — in the product-load effect's success branch (where the fetched product lands in state). Guard with a `useRef` of last-tracked slug so StrictMode's double effect doesn't double-fire. | `track('product_view', {productId: p.id, props: {slug: p.slug, name: p.name, price: <pdp price>}})` |
| `variant_select` | `Product.tsx` size button onClick (~:229) | props `{variantId, size}` + productId |
| `color_select` | `Product.tsx` color swatch onClick (~:212) | props `{color}` + productId |
| `add_to_cart` | `lib/cart.tsx` inside `add` callback (:59) | `{productId: item.productId, props: {variantId, size, color, qty, price: item.unitPrice}}` |
| `remove_from_cart` | `lib/cart.tsx` inside `remove` (:79) AND the `qty < 1` branch of `setQty` (:71) | props `{variantId}` |
| `checkout_start` | `pages/Checkout.tsx` mount effect, only when `items.length > 0`, once-per-mount `useRef` guard | props `{itemCount, subtotal}` |
| `checkout_step` | `Checkout.tsx`: in `placeOrder` (:83) → `{step:'info_submitted'}`; after `startPayment` succeeds (payment state set) → `{step:'payment_opened'}`; payment-method button onClicks (~:395-445) → `{step:'method_selected', method}` | as listed |
| `payment_result` | `Checkout.tsx` `onPay` success → `{outcome:'success'}`; `onPay` catch and `onFail` (:108) → `{outcome:'failure'}` | props `{outcome}` |
| `order_placed` | `Checkout.tsx` in `onPay` after confirm succeeds, BEFORE `clear()` is called | props `{orderId, orderNumber, total, subtotal, deliveryFee, itemCount, items: [{productId, variantId, qty, unitPrice}]}` — items mapped from cart items |
| `search` | `pages/Search.tsx` debounced fetch `.then` (~:36-41) | props `{query, results: <total count>}`; dedupe consecutive identical query via ref |
| `filter_apply` | `pages/Collection.tsx` — NEW effect watching the client-side filter state (`colors`, `priceMax`, ~:93-98) with a skip-initial-render ref and 500ms debounce (price slider storms) | props `{category, colors, priceMax}` |
| `sort_change` | `Collection.tsx` where sort is set (~:110) | props `{category, sort}` |
| `wishlist_add` / `wishlist_remove` | `lib/wishlist.tsx` `toggle` (:105): existing id → wishlist_remove else wishlist_add; `remove` (:97) → wishlist_remove | `{productId: id}` |
| `signup` | `lib/auth.tsx` `register` success | props `{method:'password'}` |
| `login` | `lib/auth.tsx` `login` success → `{method:'password'}`; `loginWithGoogle` success → `{method:'google'}` | props `{method}` |
| `newsletter_signup` | `pages/Home.tsx` NewsletterSection form onSubmit (~:249) — UI-only stub, the event is the whole signal | no props |
| `contact_submit` | `pages/Contact.tsx` `onSubmit` (:12) | props `{tab}` if the form has a tab/type state, else no props |

## Tests

- Existing suite must stay green and pristine. If provider tests (cart/wishlist/auth) now emit `/api/track` fetches, verify the Task-2 stub covers them.
- Add focused tests only where guard logic exists (they carry the risk): product_view slug-ref guard fires once per product (StrictMode double effect), filter_apply skip-initial + debounce, search dedupe. Follow existing test-file conventions in `frontend/src/__tests__/`. Do not build render-tests for every trivial `track()` line.

## Acceptance

- `npm test` green in `frontend/`, TypeScript clean.
- Zero behavior change: tracking failures cannot affect UX (track never throws by design — don't wrap call sites in extra try/catch).
