# fashion-studio — Tanvi Agnihotry couture e-commerce platform

Poly-package repo (independent npm packages, no workspaces). Each package below
has its own CLAUDE.md map that auto-loads when you touch its files.

| Folder | Role | Dev port |
|---|---|---|
| backend/  | Hono API: routes → services → SQL repos (Postgres) | 3001 |
| frontend/ | Customer storefront SPA | 5173 |
| admin/    | Atelier admin SPA | 5174 |
| socials/  | Link-in-bio + QR scan logging | 5175 |
| e2e/      | Playwright suite (needs the stack running) | — |

## Invariants
- Money = integer paise in backend/API; UIs format ₹ en-IN.
- backend/src/types.ts is the API-type source of truth, hand-mirrored into
  frontend/src/lib/types.ts + admin/src/lib/types.ts — change all three together.
- design-reference/ is a READ-ONLY design mirror — never edit it (index: its MANIFEST.md).
- Deploys are MANUAL (infra/deploy.sh), NO CI. Production tanviagnihotry.com is
  the only live environment (staging torn down 2026-08-09). Razorpay is mocked.
- Backend tests use fakes (no DB); 2 e2e specs fail on main (see e2e/CLAUDE.md).

## Where to look
- PR history: TIMELINE.md (one line per merged PR) · deep dive `gh pr view NN`.
- Pending work: TODO.md (open PRs + chores) · deep tracker PRODUCTION-TODO.md.
- Run/test commands, seeded logins: README.md.
- Infra runbook: infra/README.md. Design tokens/screens: design-reference/MANIFEST.md
  + DESIGN-NOTES.md. Spec (schema + API contract): docs/superpowers/specs/.
- Local end-to-end verification harness: `verify` skill (.claude/skills/verify).

## Maintenance (after merging any PR)
1. Prepend one line to TIMELINE.md: `#NN YYYY-MM-DD title — areas touched`.
2. Update TODO.md: drop the merged PR, tick items it completed, add follow-ups.
3. If the PR changed a package's structure, entry points, or gotchas, update that
   package's CLAUDE.md. Keep every CLAUDE.md under its cap (this file ≤60 lines,
   package files ≤50) — cut something before adding.
4. When TIMELINE.md passes ~150 lines, compress the oldest entries into an
   era-summary paragraph at the bottom.
