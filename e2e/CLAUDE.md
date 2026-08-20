# e2e — Playwright suite (desktop Chrome + Pixel 7 projects)

- tests/*.spec.ts + tests/helpers.ts (unique emails, checkout filler, stock restore)
- Starts NOTHING itself — bring the stack up first (README "Tests" section) or use
  the `verify` skill (.claude/skills/verify — isolated ports 5544/3101/4174).

## Known baseline (no CI — check this before debugging a branch)
admin-offline-orders.spec.ts and deliveries.spec.ts FAIL on main too, and the
guest-journey spec fails on the MOBILE project (the "Women" link goes to
/collection since #25; the spec expects /collection/lehenga). Always compare a
branch's failures against main's; don't chase these as regressions.

## Gotchas
- SPAs preview on 4173/4174 (strictPort); parallel Claude sessions may already
  hold the verify-skill ports.
- Specs restore the stock they consume — preserve that property in new specs.
- Storefront shows a consent bar (`ta.consent-ack`) and a first-visit offer
  pop-up (`ta.offer-seen`) since #46/#47 — seed both localStorage flags in
  specs that assume an overlay-free viewport.
