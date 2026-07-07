---
name: verify
description: Build, launch, and drive the fashion-studio apps locally to verify a change end-to-end (isolated Postgres + API + Vite preview + Playwright).
---

# Verify a change by driving the running apps

The user's dev stack often occupies ports 3001 (api) and 5433 (db) via
`docker-compose.yml` — never touch it. Spin an isolated stack instead:

```bash
# 1. Isolated Postgres 16 (port 5544, throwaway)
docker run -d --name <job>-pg -e POSTGRES_USER=boutique -e POSTGRES_PASSWORD=boutique \
  -e POSTGRES_DB=boutique -p 5544:5432 postgres:16-alpine
# wait: docker exec <job>-pg pg_isready -U boutique -d boutique

# 2. API on a free port; migrations apply at boot, dev seed gives
#    admin@tanviagnihotry.com / TanviAdmin@2026
cd backend && NODE_ENV=development PORT=3101 \
  DATABASE_URL=postgres://boutique:boutique@localhost:5544/boutique \
  JWT_SECRET=dev-secret-change-in-prod CORS_ORIGINS=http://localhost:4174 \
  SEED_ON_START=true npx tsx src/index.ts
# ready when: curl localhost:3101/api/ready -> {"status":"ready"}

# 3. A SPA: build with VITE_API_URL, then vite preview (config's production
#    guard needs VITE_API_URL set for preview too). socials serves under its
#    base path: http://localhost:4174/qr-socials/
cd socials && VITE_API_URL=http://localhost:3101 npm run build
VITE_API_URL=http://localhost:3101 ./node_modules/.bin/vite preview --port 4174
```

Drive with Playwright from `e2e/` (`@playwright/test` is installed there;
resolve it via `require.resolve('@playwright/test', {paths: ['<repo>/e2e']})`
in a throwaway .cjs script). Log page→API traffic with `page.on('request')`
filtered to the API origin. Admin JWT for protected routes:
`POST /api/auth/login {email, password}` → `token`.

Gotchas:
- CORS_ORIGINS must exactly match the preview origin or beacons fail silently.
- vite preview increments the port if taken — read its stdout, don't assume.
- Clicking `mailto:`/`tel:` links keeps the page alive in headless Chromium;
  use those to observe click beacons without navigating away.
- Inspect persisted rows directly: `docker exec <job>-pg psql -U boutique -d boutique -c '...'`.
- Tear down: kill the two node processes, `docker rm -f <job>-pg`.
