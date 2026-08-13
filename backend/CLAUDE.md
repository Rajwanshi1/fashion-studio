# backend — Hono 4 API (Node 22, pg, zod) · dev port 3001

## Layout
- src/routes/      HTTP layer, zod-validated (admin.routes.ts ~640 lines is the biggest)
- src/services/    business logic; services/ai/ = Anthropic bill/catalog parsing
- src/data/        SQL-only repositories (products.repo.ts ~780 lines)
- src/lib/         deliveries, phone, vcard helpers
- src/middleware/  auth, rate-limit
- db/migrations/   numbered SQL, append-only — NEVER edit an applied migration
- test/            unit + API tests (routes driven via app.request)

## Entry points
src/index.ts → src/app.ts (route registration + error normalization to `{ error }`).
src/db.ts · src/migrate.ts · src/seed.ts (seed-cli.ts for manual runs).

## Contract
src/types.ts is the SOURCE OF TRUTH for API types, hand-mirrored into
frontend/src/lib/types.ts and admin/src/lib/types.ts — change all three together.

## Gotchas
- Tests use fakes — a green `npm test` runs NO real SQL. Verify new SQL against a
  throwaway Postgres (long-lived dev containers are often stale).
- Money is integer paise everywhere.
- Layering: routes → services → data. No SQL above src/data/.
