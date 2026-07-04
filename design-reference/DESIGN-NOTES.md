# Tanvi Agnihotry — Design Language Distillation

Working notes distilled from the Claude Design reference (this folder). Use this as the
quick guide; the HTML/CSS files are the exact source of truth for design QA.

## Brand

- **Tanvi Agnihotry** — Indo-Western couture, made to order in India (Mumbai atelier).
- Voice: "quiet luxury" — celadon + soft gold, editorial calm, hand-craft storytelling.
- Collection: "The Verdant Edit" (Spring 2026), featured drop "Rang *Mehfil*".
- Categories: Lehenga Sets, Jacket Sets, Gowns, Anarkali (+ Sharara & Gharara in filters).
- Currency: INR, formatted `'₹' + n.toLocaleString('en-IN')` (e.g. ₹1,84,000). Prices stored in paise in the backend; design shows whole rupees.
- Ticker copy: "Complimentary Made-to-Order Consultation · Worldwide Shipping · Spring 2026 — The Verdant Edit".
- Trust row: Made to Order (4–6 weeks) / Complimentary Fittings (Mumbai) / Worldwide Shipping.
- Order numbers look like `TA-2026-04817`.

## Tokens (brand.css — import Google Fonts: Bodoni Moda, Cormorant Garamond, Jost)

Colors: paper #F7F8F4 · celadon-50 #EEF3EA · celadon-100 #E4EDE2 · celadon-200 #D9E6DA ·
celadon #CFE0D8 · celadon-400 #B9D0C6 · sage-500 #9CB6AA · sage-600 #7C9A8C ·
forest-700 #46584E · forest-800 #2F3D35 · ink #1E2620 · ink-soft #4A554D ·
gold #B0894A · gold-soft #C9AE7A · gold-pale #E6D7B8 ·
hairline rgba(30,38,32,.13) · hairline-gold rgba(176,137,74,.45). No pure black/white (surface #FFF allowed).

Type: --serif-display 'Bodoni Moda' (headings, wordmark, product names);
--serif-soft 'Cormorant Garamond' italic 300 (poetic accents, prices in summaries);
--sans 'Jost' 300 (body, UI, buttons, eyebrows).
Scale: mega clamp(3.8–10rem) · h1 clamp(2.7–5.4rem) · h2 clamp(2–3.4rem) · h3 1.65rem ·
body 1.0625rem · sm .9375rem · eyebrow .7rem. Tracking: caps .34em, wide .2em.
Body weight 300, line-height 1.65.

Geometry/rhythm: --edge 2px (sharp couture corners; pills 999px only for badges/tags/mobile CTA);
--gutter clamp(1.25–5.5rem); --section-y clamp(4.5–10rem).
Motion: --ease cubic-bezier(.22,1,.36,1); --dur 520ms; reveal rise 26px/900ms with 90ms stagger;
card image zoom scale(1.045)/1100ms; ticker 32s linear; marquee 30s.

## Chrome components (shop.css)

- **Ticker**: ink bg, gold-soft 0.6rem caps text, infinite slide.
- **Nav** (inner pages): sticky, rgba(30,38,32,.97) + blur, 3-col grid (links | wordmark | links),
  celadon-100 links with gold underline-grow hover, "Bag (n)" count in gold-soft.
  Homepage variant: fixed + transparent over hero, turns solid after 60px scroll.
- **Mobile nav** (≤820px): hamburger left, wordmark center, only Bag link right; full-screen
  forest-800 overlay: big serif links (Women/Collections/Lookbook/The House/Client Care),
  2-col sub-grid (Search/Account/Wishlist/Bag), socials, gold pill "Book an Appointment".
- **Cart drawer**: right slide-in min(420px,92vw) on paper, backdrop rgba(35,43,38,.42);
  head "Your Bag", celadon-50 note bar, items (70px thumb), subtotal serif-soft forest-700,
  gold Checkout + outline View Full Bag. Opens from any `.bag`/`[data-open-bag]`.
- **Footer**: ink bg; giant centered Bodoni wordmark (homepage variant), 4-col link grid
  (brand blurb + Shop/The House/Client Care), bottom bar © + socials.
- **Product card (.pcard)**: 3/4 image, hover zoom; flag badge top-left (paper bg, gold text);
  fav heart top-right reveals on hover; "Quick View" bar slides up; meta = gold category caps,
  Bodoni name (gold on hover), muted price. Homepage bestseller variant is centered text with
  reveal-on-hover "Add to Bag" underline link.
- **Buttons**: btn-line (gold underline, gap widens), btn-solid/btn-buy (ink→forest-700),
  btn-buy.gold (gold→gold-soft), btn-outline (gold hairline→celadon fill). All uppercase Jost
  .74–.78rem, tracking .2em.
- **Forms**: .lab tiny caps label, .inp white bg hairline border → gold on focus; custom gold
  arrow selects; checkboxes accent forest-700.
- **Others**: crumbs, page-hero (centered eyebrow+h1+p; .dark = forest-800), chips, pager,
  accordion (.acc, gold + rotates 45°), toast (ink, bottom-right, "✓ Added to your bag"),
  trust row, qty stepper.

## Page layout cribs

- **Homepage**: 100svh hero (veil gradient, eyebrow, mega uppercase title + italic sub, two CTAs,
  edge captions, vertical side label) → "Shop by category" 4-col (2-col ≤900px) → ink marquee →
  celadon-50 featured split (Rang *Mehfil*) → Bestsellers 4-col centered (2-col ≤980px) →
  lookbook cover band → trust → newsletter (underline form) → footer with giant wordmark.
- **PLP (Collection)**: 246px sticky filter sidebar + results; ≤860px sidebar collapses behind
  "Filter & Refine +" toggle. Toolbar: "24 Pieces" + sort select. Active filter chips w/ ✕.
  Grid cols-2 with a forest-800 promo tile spanning 2 cols. Pager.
- **PDP**: 1.15/0.85 split; sticky gallery (76px thumb rail, active gold outline; ≤560px thumbs
  go horizontal under stage); flags stacked pills; price serif-soft 1.7rem + "incl. of all taxes";
  color swatches, size buttons + "Made to Measure"; celadon-50 MTO note w/ gold dot; qty+Add row;
  wishlist outline; 3 accordions; forest-800 craft band; related 4-col.
- **Cart**: 1.5/0.85 grid; 116px thumbs; "Made to Order · 4–6 weeks" pill tag; sticky celadon-50
  summary (subtotal/shipping Complimentary/duties, promo row, big serif total, reassure note).
- **Checkout**: own minimal chrome (back link | wordmark | 🔒 Secure Checkout); steps line;
  express UPI/Wallet buttons + "or" divider; blocks numbered 01/03 Shipping, 02/03 Delivery
  (standard complimentary vs Priority ₹2,500), 03/03 Payment (Card fields / UPI / COD);
  gold "Place Order · ₹total"; celadon-50 summary rail (64px thumbs).
  → In the app, payment step is where masked Razorpay goes (keep design language).
- **Order Confirmation**: centered gold seal ✓, "Thank you, {name}.", meta cells (order no /
  dispatch / ship to), 5-step atelier timeline (done = gold dots), order recap on celadon-50,
  CTAs Track in My Account / Continue Shopping.
- **Auth**: split screen; left editorial art w/ caption (hidden ≤820px); right brand, tabs
  Sign In / Create Account, fields, socials Google/Apple (mask — TODO), back-home link.
- **Account**: page-hero "Welcome back, {first}"; 230px sticky side nav (Orders n / Wishlist n /
  Addresses / Profile; Book Appointment / Client Care / Sign Out); order cards: celadon-50 head
  (Order/Placed/Total + status pill: crafting=gold-pale "In the Atelier", delivered=celadon-400),
  body thumb + items + total + Track/Buy Again links; address cards (default = gold border).
- **Wishlist**: page-hero, cols-4 grid + "+ Add to Bag"/"Remove" underline buttons, empty state ♡.
- **Search**: centered band, big italic serif input with gold ⌕ underline box, Popular chips,
  results head "Results for *"query"*" + count, cols-4 grid.
- **Collections index**: intro lede italic; 2-col editorial cover cards (aspect 3/4 tall, 4/3),
  gradient veil, number caps, big serif title, blurb, "Explore →".
- **Lookbook**: forest-800 page; full-bleed cover w/ mega "The Edit"; spreads (text-left, duo,
  offset), look numbers, italic captions, "Shop the Look →", pull quote.
- **The House**: full-bleed hero italic mega; centered manifesto; numbered story rows (alt flip);
  forest-800 values band w/ 3 cells; stats row 40+/300hrs/100%; CTA pill.
- **Client Care**: quick-link cell row; FAQ accordion sections; forest-800 help band.
- **Contact**: 0.85/1.15 split — forest-800 aside (studio info blocks) + form w/ tab toggle
  (Book an Appointment / General Enquiry), success ok panel.
- **404**: forest-800 page, huge ghost "404" at 7% opacity, italic serif headline, gold + outline
  CTAs, footer-less, centered wordmark top.
- **Size Guide**: unit tabs, bordered scrollable table (celadon-50 head, gold caps), how-to-measure
  split, celadon-50 MTO CTA.

## Behaviors to replicate in React

- Scroll reveal: elements rise 26px→0 with stagger (respect prefers-reduced-motion; include
  safety timeout so content never stays hidden).
- Homepage nav transparent→solid at scrollY>60.
- Cart drawer + toast on add-to-bag; Escape closes drawer/menu; body scroll locks when overlay open.
- Ambient (pointer:fine only): magnetic buttons (translate toward cursor ~0.14x/0.22y),
  hero image parallax (scale 1.12 + slow translateY), gold silk-thread cursor trail (subtle,
  0.5 opacity max, collapses when idle) — desktop nicety; implement lightweight, skip on touch.
- PDP: thumb select (gold outline), swatch select updates color name, size select, qty stepper.
- Breakpoints seen: 1180/980/900/880/860/820(mobile nav)/760/700/680/600/560/480px.

## Imagery strategy (no photography yet)

Design uses `<image-slot>` placeholders — celadon 135° gradient (celadon-50→celadon-200),
sage-600 uppercase .66rem label. Production app: `<ImageSlot>` React component renders a real
`<img>` when the product has an image URL, else the same gradient + label placeholder so the
site looks intentional without photos. Real photography = TODO (third-party).
