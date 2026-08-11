# Site CMS preview-first UX — design

Date: 2026-08-10 · Follows: 2026-08-10-site-content-design.md (PR #30)

## Problem

The site CMS shipped description-based: `/site` is a card list of text blurbs
and `/site/:key` a flat form with an 84×112 photo tile. The boutique cannot
see how a photo will be cropped (hero is full-bleed 100svh, featured 4/5,
looks 3/4–5/4, all `object-fit: cover`) or how copy sits on the page until the
save is already live on tanviagnihotry.com.

## Decisions

- **Canvas hub.** `/site` becomes a scrollable mini-render of the storefront
  built from effective (merged) content — real photos, real copy, exact crops.
  Every CMS section is one big tap target into its editor, chipped
  `✎ Edit` + Customised/Default. Non-CMS sections (nav, categories,
  bestsellers, newsletter) stay in the flow as dimmed, non-tappable ghosts.
  Three segments: Home page, Lookbook page, Announcement bar.
- **Live editors.** `/site/:key` keeps its schema-driven form and gains a
  sticky live preview — above the form on a phone (collapsible, ≤34vh),
  beside it from 1100px — re-rendered from
  `sectionValue(key, payload(config, form))` on every keystroke, so
  blank-loses previews exactly what the site would fall back to.
- **Phone + desktop toggle.** Previews default to a 390px phone viewport with
  a one-tap switch to 1280px desktop.
- **Focal points.** Each CMS photo (hero, featured, lookbook cover, 7 looks)
  carries `focusX`/`focusY` — integer percent of the source image, rendered as
  `object-position` by the storefront. Set by tapping the *uncropped* photo in
  the form (`FocalPointField`); arrow keys nudge ±5. Absent = 50/50 = the old
  centred crop, so existing rows need no migration (column is jsonb).
- **Save stays live.** No draft/publish; PUT/DELETE semantics and the 6KB WAF
  byte budget unchanged (focus worst-case: lookbook +182 bytes, pinned by
  test).

## Architecture

- **Previews are in-admin replicas inside src-less iframes** —
  `admin/src/preview/PreviewFrame.tsx` creates an `about:blank` iframe,
  injects `storefront.css?raw`, and portals React children into its body. The
  iframe gives each preview its own viewport (storefront media queries and
  svh/vh resolve against the previewed device width, not the admin window)
  and its own document (the storefront's unscoped `.trust`/`.foot`/`.btn-buy`
  and the admin's same-named rules cannot collide). Frames lay out at real
  device width and transform-scale down to the pane; the wrapper crops to
  content height.
- **Never iframe the live storefront** — prod sends `X-Frame-Options: DENY`
  on both distributions (infra/templates/main.yaml).
- **Markup mirrors** (`admin/src/preview/sections.tsx`) copy the storefront
  JSX class-for-class, props-only and inert (bare href-less `<a>`, pointer
  events killed). `storefront.css` mirrors the needed blocks of `brand.css`,
  `app.css`, `home.css`, `shop.css`, `lookbook.css` — each block names its
  source, and the five source files carry reverse breadcrumbs. `Reveal`/
  `Ambient` are deliberately not ported (document-wide selectors,
  IntersectionObserver opacity traps).
- **Merge reuse.** `effectiveContent()` (siteContent.ts) types the canvas
  bundle over the existing `sectionValue` merge; the editor preview feeds on
  `payload()` — no fourth copy of the merge rules.

## Out of scope

Draft/preview-before-publish, revision history, editing non-CMS sections,
in-preview tap-to-edit fields, CSS-mirror lint tooling.

## Verification

RTL: canvas (site.test.tsx), mirrors + frame (preview.test.tsx), live preview
+ focal interactions (siteSectionEdit.test.tsx); frontend merge/render and
backend schema/byte-budget tests. Manual `verify`-skill pass for scaling,
animation and real uploads. Post-deploy: load `/site` on the deployed admin —
the iframe-inherited CSP cannot be exercised under vite (CSP lives only in
CloudFront).
