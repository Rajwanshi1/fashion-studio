# admin — atelier admin SPA (Vite, React 18) · dev port 5174

## Layout
- src/pages/       dashboard, products, orders, offline intake (Scan Bill), deliveries,
                   payments, users, analytics, socials QR, site canvas + editors.
                   Giants: SiteSectionEdit.tsx ~1000 lines, ProductEdit.tsx ~790.
- src/components/  shared admin chrome
- src/preview/     storefront preview: markup + CSS mirrors rendered in src-less
                   iframes (PreviewFrame) — /site canvas and editor live previews
- src/lib/         api.ts · types.ts · helpers
- src/__tests__/   RTL tests

## Gotchas
- lib/types.ts mirrors backend/src/types.ts response shapes — change together.
- preview/storefront.css + preview/sections.tsx hand-mirror storefront markup/CSS
  (sources carry breadcrumbs); RTL `screen` can't see into the preview iframes —
  query `iframe.contentDocument` or test the section components directly.
- vitest css option is `{ include: [/preview\/storefront\.css/] }`, NOT false —
  plain `css: false` also blanks the `?raw` import PreviewFrame injects.
- QR generator base URL is hardcoded to the production origin — intentional
  (printed QRs outlive environments); nothing to configure.
- HEIC photo conversion runs libheif wasm — needs 'wasm-unsafe-eval' in CSP, and
  CSP is set ONLY in CloudFront (infra/), so breakage shows up in prod only —
  same trap for the preview iframes (src-less, inherit the admin CSP): check
  /site on the deployed admin after CSP changes.
- Scan Bill wizard calls backend services/ai/ for parsing.
