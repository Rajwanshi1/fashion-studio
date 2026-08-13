# Audit remediation — production runbook

Companion to the three PR stacks fixing the external brand & site audit of
11 Aug 2026 (`tanvi-agnihotry-audit.html`): #41 (P0 ship-blockers, base main),
#42 (consistency, base #41), #43 (house layer, base #42). Code alone does not
finish the job — each stack has a live-data / CMS step after deploy. Deploys
are manual (`infra/deploy.sh`): backend image FIRST (migrations 013/014/015 run
on boot), then SPAs. After any admin deploy, open `/site` on the deployed admin
once (the preview iframes inherit the CloudFront-only CSP).

## After stack A (#41) deploys

Verify live:
- A purple piece's PDP shows its real colour name + one truthful dot (no mint).
- Every size chip is clickable at 0 stock; an out-of-stock size completes a
  (mocked-Razorpay) checkout; the dashboard lists the piece under "Made to
  Order Only" and Products shows the negative stock honestly.
- A PDP opened in a background tab paints without scrolling.
- View-source shows the new title/meta/OG; `/about` lands on The House;
  `robots.txt` and `sitemap.xml` resolve; no `href="#"` socials anywhere.

Then: shoot/upload a proper 1200×630 OG card and swap `og:image` in
`frontend/index.html` (it points at the logo until then).

## After stack B (#42) deploys

CMS review in admin `/site` — live overrides beat the new defaults, so audit
each section against the audit's truth table:
- hero: the live "jahan har rang ek kissa sunata hai" override matches the new
  default — keep (or Reset to default; they now agree).
- ticker/marquee: delete any remaining "Verdant"/"Spring 2026" text; the
  defaults now read Rang Mehfil — Festive 2026.
- lookbookCover: remove any "Seventeen kurta sets"/"32 Looks" copy — counts are
  never typed anywhere any more.
- footer: blurb should be the Jaipur-atelier line; set Pinterest only when a
  real account exists.
- Fill the new **Brand Facts** section (address, phone, email, current
  collection, lead times) — Contact, PDP lead times and the shop eyebrow read it.

Verify: ticker on the homepage; identical nav on home/inner/mobile; footer says
Client Care (not Press); category tiles show only categories with pieces;
`/collections` redirects; the PLP has no size/occasion/price pseudo-filters.

## After stack C (#43) deploys

Admin data edits — the 12 pieces (each row's `collection` value names it):
1. Fix the spelling twins: every "Kalidar …" → "Kalidaar …" (name field).
2. Rename each piece from its sub-collection per the audit's naming rule
   (the name is the poetry, the silhouette is the subtitle) — e.g. name
   "Bahaar", description keeps "Kalidaar kurta set, purple".
3. Set each piece's **slug** to the clean form (e.g. `bahaar-purple`). Old
   links — including the `-2` era and misspelt ones — keep redirecting via
   aliases; the address bar canonicalises on load.
4. Fill **Provenance** (karigar first name, honest hours, techniques, finish
   date) only where the facts are known. Blank beats guessed.

CMS: review the **Archive** section (`/site` → The Archive) — Volume 01 ·
Rang Mehfil · Festive 2026 · the five sub-collections · status line. Add a
volume each season; never remove one.

Verify: every old product URL loads and canonicalises; `/archive` computes 12
pieces for Volume 01; a PDP with provenance shows the line, one without shows
nothing.

## Deferred deliberately (recorded, not forgotten)

Per-product OG cards (needs Lambda@Edge on the CSR SPA) · dynamic product
sitemap (after the rename pass settles) · category images/visibility flags
(productCount filtering suffices at this catalogue size) · provenance print
card for the box · the signature-motif decision (jharokha arch vs lotus
neckline — a brand call for Tanvi, not a code change).
