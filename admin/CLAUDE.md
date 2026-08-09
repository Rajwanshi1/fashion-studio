# admin — atelier admin SPA (Vite, React 18) · dev port 5174

## Layout
- src/pages/       dashboard, products, orders, offline intake (Scan Bill), deliveries,
                   payments, users, analytics, socials QR.
                   Giants: ProductEdit.tsx ~790 lines, OrderIntake.tsx ~700.
- src/components/  shared admin chrome
- src/lib/         api.ts · types.ts · helpers
- src/__tests__/   RTL tests

## Gotchas
- lib/types.ts mirrors backend/src/types.ts response shapes — change together.
- QR generator base URL is hardcoded to the production origin — intentional
  (printed QRs outlive environments); nothing to configure.
- HEIC photo conversion runs libheif wasm — needs 'wasm-unsafe-eval' in CSP, and
  CSP is set ONLY in CloudFront (infra/), so breakage shows up in prod only.
- Scan Bill wizard calls backend services/ai/ for parsing.
