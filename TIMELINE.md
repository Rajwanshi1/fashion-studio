# TIMELINE — merged PRs

Newest first **by merge date** — PR numbers can be out of order (#17 merged after
#13–16 landed; #2 before #1). Gaps (#5, #11, #12, #20) were never merged.
Format: `#NN YYYY-MM-DD title — top-level areas touched`.
Deep dive: `gh pr view NN` / `gh pr diff NN` (repo Rajwanshi1/fashion-studio).
Cap: past ~150 lines, compress the oldest entries into an era-summary paragraph
at the bottom — don't delete history.

- #43 2026-08-13 Audit remediation A-C: MTO stock model, copy/consistency sweep, brand-facts+archive CMS, slug aliases, provenance (#41/#42 closed into this) — backend, frontend, admin, docs, TODO
- #40 2026-08-13 Honest PDP colour swatches from per-photo AI-read colours — backend, frontend, admin, docs
- #39 2026-08-13 "This order contains" components replace the dupatta/jacket add-ons — backend, frontend, admin, e2e, docs
- #38 2026-08-11 Preview-first Site CMS: canvas hub, live editors, focal-point picker — admin, frontend (CSS breadcrumbs), docs
- #37 2026-08-11 Focal point for CMS images: focusX/focusY through the three mirrors — backend, frontend, admin
- #36 2026-08-11 PDP swipe gallery, admin drag-and-drop photo reorder, mobile nav fix — frontend, admin, backend
- #35 2026-08-10 UAT fixes D: polish & accessibility (TA-021, 023, 028, 033-036, 039-047) — admin, backend
- #34 2026-08-10 UAT fixes C: catalogue-linked items, unsaved-changes guard, hidden-by-default pieces — admin, backend, e2e
- #33 2026-08-10 UAT fixes B: unified ledger, honest dashboard, IST dates (TA-005..007, 010, 012, 016, 017) — admin, backend, e2e
- #32 2026-08-10 UAT fixes A: guard destructive actions, make failures visible (P0s + TA-008/009/014/015) — admin, backend, e2e, infra
- #30 2026-08-10 Site content CMS: admin-editable storefront content (mweb-first) — backend, frontend, admin, docs
- #28 2026-08-10 Nav: inline search bar in the top bar; tokenized multi-column search — frontend, backend
- #27 2026-08-10 Made to Measure continues the order flow (no contact-form detour) — frontend, backend, admin, docs
- #26 2026-08-10 Fix mobile overlap: reset sticky columns when their grids collapse — frontend
- #25 2026-08-09 Storefront all-pieces view + social marks on login — backend, frontend
- #24 2026-08-09 CSP: allow wasm compilation on the admin distribution — infra
- #23 2026-08-09 Products admin: batch actions, richer columns, filters — admin, backend, e2e, infra
- #22 2026-08-09 WAF: allow oversized body only on the image-naming presign — infra
- #21 2026-08-09 Products v2: sale pricing, color families, multi-image galleries, cost price, chip-based admin form — admin, backend, frontend
- #19 2026-08-08 Redesign scan-bill flow: capture tiles, parse progress, photo rail, a11y — admin, e2e
- #18 2026-08-03 Fix bill parsing: SDK non-streaming precheck + schema union limit — admin, backend
- #16 2026-07-30 Delivery-priority dashboard + iPhone contacts export + mobile polish (order mgmt 4/4) — admin, backend, e2e
- #15 2026-07-30 Bill photo upload + Claude parsing + Scan Bill wizard (order mgmt 3/4) — admin, backend, e2e, infra
- #14 2026-07-30 Order channels, offline orders, receipts ledger, admin order management (order mgmt 2/4) — admin, backend, e2e, frontend
- #13 2026-07-30 Phone-first identity + universal OTP login (order mgmt 1/4) — admin, backend, e2e, frontend, infra
- #17 2026-07-30 Catalog v2: new taxonomy, set-includes pricing, bulk delete, image upload, collections & merch fields — admin, backend, e2e, frontend, infra
- #10 2026-07-20 Dark green #3B4B3F restyle + QR socials content refresh — admin, frontend, socials
- #9 2026-07-20 First-party user-behavior analytics (storefront events → admin dashboard) — admin, backend, e2e, frontend
- #8 2026-07-18 Production deployment: tanviagnihotry.com, NAT gateway, payments gate — backend, frontend, infra, scripts
- #7 2026-07-07 QR hex-code paste + always-prod QR base URL — admin, infra
- #6 2026-07-07 QR-socials click tracking, /qr-socials path serving, QR color picker — admin, backend, infra, socials
- #4 2026-07-07 AWS staging deployment (CloudFormation, segregated app/data, protected data layer) — infra, docs, all packages
- #3 2026-07-06 fix(payments): require order ownership on checkout/confirm — backend, e2e, frontend
- #1 2026-07-06 PRODUCTION-TODO.md go-live tracker (34 items) — root docs
- #2 2026-07-06 Socials link-in-bio page + QR scan-source tracking — socials, admin, backend, docs

Non-PR events worth knowing:
- 2026-08-09 AWS staging environment fully torn down (data unrecoverable);
  production (tanviagnihotry.com) is the only live environment.
