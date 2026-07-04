# Design Reference Manifest

Mirrored from Claude Design project `20c88fe1-743b-4841-835d-d857410f2c8c`
(https://claude.ai/design/p/20c88fe1-743b-4841-835d-d857410f2c8c) via DesignSync on 2026-07-05.
All files are verbatim copies and are REFERENCE ONLY — the production apps live in
`frontend/`, `admin/`, `backend/`.

## Imported (21 files)

Stylesheets:
- brand.css — design tokens (colors, type, spacing, motion) + shared atoms
- shop.css — shop chrome: ticker, nav, footer, product cards, forms, accordion, chips, toast

Screens:
- Homepage.html            — hero, categories, marquee, featured, bestsellers, lookbook cover, trust, newsletter
- Collection.html          — PLP: filter sidebar, sort toolbar, active chips, product grid + promo tile, pager
- Collections.html         — collections index (editorial cover cards)
- Product Detail.html      — gallery + thumbs, swatches, sizes, MTO note, qty/add, accordions, craft band, related
- Cart.html                — line items, qty steppers, order summary, promo code
- Checkout.html            — minimal chrome, steps, contact/shipping/delivery/payment blocks, summary rail
- Order Confirmation.html  — seal, meta cells, atelier timeline, order recap
- Login.html               — split auth (art + tabs sign-in/register)
- Account.html             — sidebar nav, order cards with status badges, address cards
- Wishlist.html            — saved grid with add-to-bag/remove, empty state
- Search.html              — big italic search band, popular chips, results grid
- Lookbook.html            — dark editorial spreads, pull quote
- The House.html           — about: hero, manifesto, story rows, values band, stats
- Client Care.html         — FAQ accordions + quick links
- Contact.html             — dark aside + appointment/enquiry form
- Size Guide.html          — size table, how-to-measure, MTO CTA
- 404.html                 — dark forest ghost-404 page
- Design System.html       — full token/component documentation (source of truth for design QA)

Scripts (design-tool prototypes; replicate BEHAVIOR in React, do not copy code):
- mobile-nav.js  — hamburger + full-screen forest overlay menu (breakpoint 820px)
- cart-drawer.js — slide-out mini bag (min(420px,92vw)), opens from .bag / [data-open-bag]
- reveal.js      — IntersectionObserver scroll reveal (.rv/.rv-in, 90ms stagger, safety nets)
- ambient.js     — silk-thread gold cursor trail (three.js, pointer:fine only), magnetic CTAs, hero parallax
- image-slot.js  — Claude Design canvas placeholder element (visual empty state: celadon gradient + label)

## Deliberately NOT imported

- "All Screens.html", "All Screens-print.html", .thumbnail — design-tool catalog artifacts
- "Tanvi Agnihotry - Design System (standalone).html" — duplicate of Design System.html
- .image-slots.state.json, uploads/*.png, screens/check-01.png — design-tool image-drop state /
  pasted bitmaps (binary, tool-specific). The production app uses its own on-brand imagery
  (celadon-gradient placeholder aesthetic per brand.css `image-slot` styling) until real product
  photography is provided (see project TODOs).

## Security note

The prototype scripts use innerHTML with static, hardcoded template strings (design-tool context
only). The React implementation must NOT use innerHTML / dangerouslySetInnerHTML.
