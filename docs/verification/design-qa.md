# Design Fidelity QA — Storefront vs Claude Design Reference

Date: 2026-07-06 · Method: Playwright (chromium) screenshots of the production build
(`vite preview`, live dockerized API) side-by-side with the reference HTML opened from
`design-reference/` via file://. Viewports 1440×2400 and 390×2400, reduced-motion enabled
for stable captures. Shots regenerable with `scripts/design-qa-shots.mjs` (run from `e2e/`);
PNGs kept out of git (5 MB) — see .gitignore.

## Pairs compared

| Screen | Desktop | Mobile (390px) |
|---|---|---|
| Homepage (hero, nav) | MATCH | MATCH (hamburger + wordmark + bag) |
| Collection / PLP | MATCH (sidebar, chips, promo tile, flags, pager area) | MATCH (Filter & Refine toggle, 2-col grid) |
| Product Detail | MATCH (gallery rail, flags, swatches, sizes, MTO note, buy row, accordions, craft band) | MATCH (thumbs move below stage, stacked sections) |

Earlier in-browser pass (Chrome) additionally confirmed: category grid, ink marquee,
Rang *Mehfil* featured band, lookbook cover band on the homepage.

## Intentional / live-data differences (not defects)

1. Bag count is live (reference hardcodes "(2)"); demo cart contents replaced by real cart.
2. Product grids show real seeded catalog (names/prices/flags from the design copy) instead
   of the reference's fixed 8 placeholder cards; counts are real (e.g. "8 Pieces" vs "24").
3. Active-filter chips reflect actually-applied filters (reference decoratively showed
   Sage + Size S).
4. PLP price slider defaults to max so no seeded product is hidden on first load.
5. PDP: default selected size is the first in-stock variant (reference showed S); the seeded
   `Custom` variant renders AS the "Made to Measure" chip (selectable like any size, with an
   optional measurements note — no appointment-booking redirect); one extra made-to-order
   bullet in Details & Composition.
6. Image slots render the design system's celadon-gradient placeholder (no photography yet
   — see TODO-THIRD-PARTY.md); the design tool's tiny image icon glyph is not reproduced.

Verdict: design language (tokens, type, spacing, chrome, interactions, breakpoints) is
reproduced faithfully on desktop and mobile; no visual defects found.
