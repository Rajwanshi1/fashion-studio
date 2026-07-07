# Tanvi Agnihotry — Couture Boutique Platform

E-commerce platform for the Tanvi Agnihotry Indo-Western couture house. Design language
comes from the Claude Design reference mirrored in [`design-reference/`](design-reference/)
(distilled in [`DESIGN-NOTES.md`](design-reference/DESIGN-NOTES.md)).

## Packages

| Package | What | Stack | Port (dev) |
|---|---|---|---|
| [`backend/`](backend/) | Marketplace API — app layer (routes → services) + data layer (SQL-only repositories + PostgreSQL container) | Hono 4, pg, zod, Node 22 | 3001 |
| [`frontend/`](frontend/) | Customer storefront (mobile-first, matches the reference screens exactly) | Vite, React 18, react-router 6 | 5173 |
| [`admin/`](admin/) | Atelier admin — dashboard, inventory, orders, payments, socials QR | Vite, React 18 | 5174 |
| [`socials/`](socials/) | Link-in-bio page for `socials.<domain>.com` — links + contact, logs QR scan sources | Vite, React 18 | 5175 |
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

# 4. Socials link page (QR landing)
cd socials && npm install && npm run dev         # http://localhost:5175
```

QR flow: admin → Socials → generate a QR per placement (e.g. `store-window`); it encodes
`https://tanviagnihotry.com/qr-socials/?src=store-window` — always the production origin,
since printed QRs outlive any environment. Each scan logs the source via
`POST /api/socials/scan`; counts appear on the same admin page.

Seeded logins: admin `admin@tanviagnihotry.com` / `TanviAdmin@2026` ·
demo customer `aanya@example.com` / `Aanya@2026`.
API base for the SPAs: `VITE_API_URL` (defaults to `http://localhost:3001`).
Backend env (see `docker-compose.yml`): `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`,
`SEED_ON_START`, `PORT`, `MIGRATIONS_DIR`.

## Tests

```bash
cd backend  && npm test        # 122 unit + API tests (services w/ fakes, routes via app.request)
cd frontend && npm test        # 18 RTL tests (cart, checkout incl. mock payment, PLP/PDP, 404)
cd admin    && npm test        # 15 RTL tests (auth guard, dashboard, orders, product edit, socials)
cd socials  && npm test        # 10 RTL tests (links render, scan beacon)

# Live API verification against the containers (37 checks):
./scripts/verify-api.sh                          # results: docs/verification/backend-api.md

# End-to-end (starts nothing itself — bring the stack up first):
docker compose up -d
export VITE_API_URL=http://localhost:3001        # production-mode builds now fail loud without it (PRODUCTION-TODO #8)
(cd frontend && npm run build && npm run preview -- --port 4173 --strictPort &)
(cd admin    && npm run build && npm run preview -- --port 4174 --strictPort &)
cd e2e && npm install && npx playwright install chromium && npm test
                                                 # results: docs/verification/e2e.md
```

Design-fidelity QA (screenshots app vs reference): `docs/verification/design-qa.md`
(regenerate with `node ../scripts/design-qa-shots.mjs` from `e2e/`).

## Deployment

### Deployment (staging)

A staging environment is live on AWS, provisioned entirely by CloudFormation (see
[`infra/README.md`](infra/README.md) for the stack map, deploy driver, and restore
runbook): VPC + EC2 Postgres with DLM snapshots and in-region `pg_dump` backups, an
ALB/ASG API tier, and CloudFront+S3 (WAF-fronted) for all three SPAs — 4 stacks
(network/data/main/waf) after the 2026-07-07 `app`/`edge` consolidation. This
supersedes the Amplify Hosting plan below for the deployed environment — `amplify.yml`
is kept only as a reference and is not used by `infra/`.

- Storefront `https://d3rb2k31ty2kox.cloudfront.net`
- Admin `https://dr7ymafumqo0k.cloudfront.net`
- Socials `https://d3byxnyud664li.cloudfront.net`
- API `https://d2bc3rl4v1olva.cloudfront.net`

(URLs rotated 2026-07-07 when the `app`/`edge` stacks were consolidated into one
`main` stack — see [`infra/README.md`](infra/README.md) and
[`docs/verification/staging-resources.md`](docs/verification/staging-resources.md).)

Verification: [`docs/verification/staging-resources.md`](docs/verification/staging-resources.md)
(stack/resource inventory), [`docs/verification/staging-e2e.md`](docs/verification/staging-e2e.md)
(API-contract script + full Playwright suite against the live URLs), and
[`docs/verification/staging-security-audit.md`](docs/verification/staging-security-audit.md)
(security probes + a refused-deletion demonstration of the data layer's protections).

This is staging, not production — no custom domain/prod TLS, no live Razorpay keys, no
CI yet. Remaining go-live work: [`PRODUCTION-TODO.md`](PRODUCTION-TODO.md).

### Deployment (production — not yet executed)

- **Storefront + admin + socials → AWS Amplify Hosting.** Build spec committed in
  [`amplify.yml`](amplify.yml) (monorepo appRoots `frontend`, `admin`, `socials`). Add the
  SPA rewrite rule and set `VITE_API_URL` (instructions at the top of the file); point the
  `socials.<domain>.com` custom domain at the socials app. (The admin QR generator's base
  URL is hardcoded to production — nothing to configure.)
  (The staging environment above uses CloudFormation-managed S3+CloudFront instead —
  this Amplify path is one option for production, not the only one.)
- **Backend → containers on EC2** (or any cloud/VM): the same `docker compose up -d --build`
  runs the api + postgres pair; nothing in the code is AWS-specific. Put a TLS-terminating
  proxy (Caddy/nginx/ALB) in front, set real `JWT_SECRET`/`CORS_ORIGINS`, use a managed
  volume/backup for `dbdata`.
- All pending go-live work (third-party setup, security blockers, hardening):
  [`PRODUCTION-TODO.md`](PRODUCTION-TODO.md).

## Documentation map

- Spec (schema + API contract): `docs/superpowers/specs/2026-07-05-fashion-boutique-design.md`
- Implementation plan: `docs/superpowers/plans/2026-07-05-fashion-boutique.md`
- Verification records: `docs/verification/` (live API, E2E, design QA, staging resources/E2E/security audit)
- Infra runbook (staging/prod CloudFormation stacks, deploy driver, restore steps): `infra/README.md`
- Design reference & tokens: `design-reference/`
