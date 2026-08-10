# TODO — active work tracker

Everything pending, at a glance. Deep go-live tracker: PRODUCTION-TODO.md
(P0 security / P0 deploy / P1 hardening / P2 post-launch).
Keep current: remove items as they land (a merged PR moves to TIMELINE.md), add
work as it's discovered. Refresh the PR list with `gh pr list --state open`.
Keep this file under ~60 lines.

## Open PRs (as of 2026-08-10)
- #26 open  Fix mobile overlap: reset sticky columns when their grids collapse
- #30 draft Site content CMS: admin-editable storefront content (mweb-first)
- #29 draft Invoicing: PDF cash memo + WhatsApp Cloud API send — blocked on Meta
            onboarding + phone-number decision
- #28 draft Inline top-bar search matching fabric/craft/occasion/category
- #27 draft Made to Measure continues the order flow (no contact-form detour)
- #20 draft Admin mobile-first UX overhaul: app shell, UI kit, order pages
- #12 draft Inline inventory editing from the products list
- #11 draft Infra go-live follow-ups (resolver-proof delegation gate)

## Chores / known issues
- Fix the 2 e2e specs failing on main: admin-offline-orders.spec.ts,
  deliveries.spec.ts (red since before current branches — see e2e/CLAUDE.md).
- Staging teardown (2026-08-09) leftover: one AWS secret still needs manual
  deletion (needs Sarthak).
- No CI — all tests run manually (see PRODUCTION-TODO P1).

## Go-live headline (full list: PRODUCTION-TODO.md)
- Payments are gated/mocked in production — live Razorpay integration pending.
