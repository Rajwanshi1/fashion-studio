# frontend — customer storefront SPA (Vite, React 18, react-router 6) · dev port 5173

## Layout
- src/pages/       route screens (Checkout.tsx ~600 lines is the biggest)
- src/components/  shared chrome (header, cart drawer, product cards)
- src/lib/         api.ts fetch wrapper · types.ts · cart/format helpers
- src/styles/      one CSS file per page — find a page's styles by name
- src/__tests__/   RTL tests

## Gotchas
- lib/types.ts is a hand-mirror of backend/src/types.ts — never edit independently.
- UI matches design-reference/ screens exactly — check design-reference/MANIFEST.md
  and DESIGN-NOTES.md before styling changes.
- Money arrives as integer paise; format `₹x,xx,xxx` (en-IN) in the UI.
- API base: VITE_API_URL — production-mode builds fail loud without it.
