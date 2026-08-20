# TODO — active work tracker

Everything pending, at a glance. Deep go-live tracker: PRODUCTION-TODO.md
(P0 security / P0 deploy / P1 hardening / P2 post-launch).
Keep current: remove items as they land (a merged PR moves to TIMELINE.md), add
work as it's discovered. Refresh the PR list with `gh pr list --state open`.
Keep this file under ~60 lines.

## Open PRs (as of 2026-08-20)
- #20 draft Admin mobile-first UX overhaul: app shell, UI kit, order pages
- #12 draft Inline inventory editing from the products list
- #11 draft Infra go-live follow-ups (resolver-proof delegation gate)

## Chores / known issues
- Post-deploy (2026-08-20, prod == main `6ae7e52`; backfills done): ≥24h after
  the URL backfill, run the KeepLegacyPublicRead=false main changeset
  (media-cdn-runbook step 8) and verify direct S3 reads 403. Sarthak: confirm
  the 2 SNS subscription emails (us-east-1 + ap-south-1) or alarms stay
  silent. Quarterly: `prune:events`.
- Audit remediation (merged via #43, deployed 2026-08-20): run
  docs/audit-remediation-runbook.md — CMS review, the 12 renames, provenance.
- e2e has NOT run over #45-#48 (unit suites + throwaway-Postgres proofs only):
  run the verify skill against merged main; seed `ta.consent-ack` (new consent
  bar) and `ta.offer-seen` (first-order pop-up) in specs that assume a clean
  overlay-free viewport.
- Components follow-ups, one chore PR after prod soak: a migration dropping
  the dupatta_price/jacket_price columns on products + order_items; remove the
  checkout include-boolean shim (orders.routes.ts) and the admin
  legacyRemovedField 400s (admin.routes.ts).
- Mobile e2e journey spec expects /collection/lehenga but the mobile "Women"
  link goes to /collection since #25 — align spec or nav (mobile project only,
  red on main).
- From /code-review on #39/#40, cut for space: Wishlist quick-add duplication;
  repeated "· With X & Y" line template. (Home quick-add removed by the audit
  stack.)
- Site CMS follow-up (from /code-review on #38): consider replacing the
  hand-mirrored admin/src/preview/storefront.css with cross-package ?raw
  imports — trades drift risk for package coupling; discussion on #38.
- Fix the 2 e2e specs failing on main: admin-offline-orders.spec.ts,
  deliveries.spec.ts (red since before current branches — see e2e/CLAUDE.md).
- Staging teardown (2026-08-09) leftover: one AWS secret still needs manual
  deletion (needs Sarthak).
- No CI — all tests run manually (see PRODUCTION-TODO P1).
- Shop-page footer (.foot-col) overflows ~15px at 320px viewports — pre-existing
  on prod, spotted during #36 verification.

## Go-live headline (full list: PRODUCTION-TODO.md)
- Payments are gated/mocked in production — live Razorpay integration pending.
