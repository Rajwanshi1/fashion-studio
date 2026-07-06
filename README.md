# Tanvi Agnihotry — Couture Boutique Platform

E-commerce platform for the Tanvi Agnihotry Indo-Western couture house. Design language
comes from the Claude Design reference mirrored in [`design-reference/`](design-reference/)
(distilled in [`DESIGN-NOTES.md`](design-reference/DESIGN-NOTES.md)).

## Packages

| Package | What | Stack | Port (dev) |
|---|---|---|---|
| [`backend/`](backend/) | Marketplace API — app layer (routes → services) + data layer (SQL-only repositories + PostgreSQL container) | Hono 4, pg, zod, Node 22 | 3001 |
| [`frontend/`](frontend/) | Customer storefront (mobile-first, matches the reference screens exactly) | Vite, React 18, react-router 6 | 5173 |
| [`admin/`](admin/) | Atelier admin — dashboard, inventory, orders, payments | Vite, React 18 | 5174 |
| [`e2e/`](e2e/) | Full-stack browser tests (desktop + Pixel 7) | Playwright | — |

Money is always **integer paise** in the backend/API; UIs format `₹x,xx,xxx` (en-IN).
Guest checkout is supported; accounts use JWT (HS256). **Razorpay is masked** — a mock
provider + in-app "Test Mode" modal simulate payment; see
[`PRODUCTION-TODO.md`](PRODUCTION-TODO.md) for the go-live checklist (blocking security
note included).

## Run it

```bash
# 1. Data layer + API (builds image, runs migrations, seeds catalog on first boot)
docker compose up -d --build         # API http://localhost:3001, Postgres on host :5433

# 2. Storefront
cd frontend && npm install && npm run dev        # http://localhost:5173

# 3. Admin
cd admin && npm install && npm run dev           # http://localhost:5174
```

Seeded logins: admin `admin@tanviagnihotry.com` / `TanviAdmin@2026` ·
demo customer `aanya@example.com` / `Aanya@2026`.
API base for the SPAs: `VITE_API_URL` (defaults to `http://localhost:3001`).
Backend env (see `docker-compose.yml`): `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`,
`SEED_ON_START`, `PORT`, `MIGRATIONS_DIR`.

## Tests

```bash
cd backend  && npm test        # 90 unit + API tests (services w/ fakes, routes via app.request)
cd frontend && npm test        # 18 RTL tests (cart, checkout incl. mock payment, PLP/PDP, 404)
cd admin    && npm test        # 9 RTL tests (auth guard, dashboard, orders, product edit)

# Live API verification against the containers (37 checks):
./scripts/verify-api.sh                          # results: docs/verification/backend-api.md

# End-to-end (starts nothing itself — bring the stack up first):
docker compose up -d
(cd frontend && npm run build && npm run preview -- --port 4173 --strictPort &)
(cd admin    && npm run build && npm run preview -- --port 4174 --strictPort &)
cd e2e && npm install && npx playwright install chromium && npm test
                                                 # results: docs/verification/e2e.md
```

Design-fidelity QA (screenshots app vs reference): `docs/verification/design-qa.md`
(regenerate with `node ../scripts/design-qa-shots.mjs` from `e2e/`).

## Deployment (out of scope for this iteration — prepared, not executed)

- **Storefront + admin → AWS Amplify Hosting.** Build spec committed in
  [`amplify.yml`](amplify.yml) (monorepo appRoots `frontend` and `admin`). Add the SPA
  rewrite rule and set `VITE_API_URL` (instructions at the top of the file).
- **Backend → containers on EC2** (or any cloud/VM): the same `docker compose up -d --build`
  runs the api + postgres pair; nothing in the code is AWS-specific. Put a TLS-terminating
  proxy (Caddy/nginx/ALB) in front, set real `JWT_SECRET`/`CORS_ORIGINS`, use a managed
  volume/backup for `dbdata`.
- All pending go-live work (third-party setup, security blockers, hardening):
  [`PRODUCTION-TODO.md`](PRODUCTION-TODO.md).

## Documentation map

- Spec (schema + API contract): `docs/superpowers/specs/2026-07-05-fashion-boutique-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-05-fashion-boutique.md`
- Verification records: `docs/verification/` (live API, E2E, design QA)
- Design reference & tokens: `design-reference/`
