# TODO — active work tracker

Everything pending, at a glance. Deep go-live tracker: PRODUCTION-TODO.md
(P0 security / P0 deploy / P1 hardening / P2 post-launch).
Keep current: remove items as they land (a merged PR moves to TIMELINE.md), add
work as it's discovered. Refresh the PR list with `gh pr list --state open`.
Keep this file under ~60 lines.

## Open PRs (as of 2026-08-11)
- #20 draft Admin mobile-first UX overhaul: app shell, UI kit, order pages
- #12 draft Inline inventory editing from the products list
- #11 draft Infra go-live follow-ups (resolver-proof delegation gate)

## Chores / known issues
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
