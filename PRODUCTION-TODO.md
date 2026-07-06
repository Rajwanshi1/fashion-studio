# Production TODO — go-live tracker

Single source of truth for everything pending before (and shortly after) taking the
platform to production. Findings come from three codebase audits (2026-07-06: code-marker
sweep, backend hardening, frontend/deploy readiness) plus the former `TODO-THIRD-PARTY.md`
(absorbed here).

**Progress: 0/34 done.**

Suggested order of attack: **P0 security → P0 deploy → P1 → P2.** Every P0 item is
individually exploitable or breaks the deployed site — never go live with any unchecked.

---

## P0 — Security blockers ⚠

- [ ] **1. Real Razorpay provider + production guard** ⚠
  In mock mode `POST /api/payments/confirm` trusts a client-supplied `outcome` — anyone
  can mark any order paid (free goods). The mock provider is instantiated unconditionally
  with no env gate; the guard the old TODO demanded was never implemented.
  Fix: implement `RazorpayProvider` (create order via Orders API; verify
  `HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, key_secret)`); add a
  signature-verified webhook for async capture; select provider via `PAYMENT_PROVIDER`
  env and **refuse to boot with the mock when `NODE_ENV=production`**. Storefront: load
  `https://checkout.razorpay.com/v1/checkout.js` and open real Checkout instead of the
  mock modal. Needs a Razorpay account → `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`;
  enable COD/UPI rules in the dashboard as desired.
  Where: `backend/src/index.ts:37`, `backend/src/services/payments.service.ts:80-113`,
  `backend/src/routes/payments.routes.ts:22-25`, `frontend/src/components/RazorpayMock.tsx`.

- [ ] **2. `JWT_SECRET` mandatory + validated at boot** ⚠
  Falls back to `'dev-secret-change-in-prod'`, and docker-compose ships that literal
  value → forgeable HS256 admin tokens if a deploy forgets to override.
  Fix: throw at boot when unset, equal to the known default, or too short (≥32 chars).
  Where: `backend/src/config.ts:15`, `docker-compose.yml:24`.

- [ ] **3. Known-password seed admin must never reach prod** ⚠
  `admin@tanviagnihotry.com` / `TanviAdmin@2026` is committed to the repo (and README)
  and recreated on every boot while `SEED_ON_START=true` — full admin takeover for
  anyone who has seen the repo.
  Fix: `SEED_ON_START=false` in prod; create the real admin with a strong unique
  password (rotate if the seed ever ran); consider refusing to seed when
  `NODE_ENV=production`.
  Where: `backend/src/seed.ts:241-252`, `docker-compose.yml:26`.

- [ ] **4. Production compose/env overlay** ⚠
  Dev compose is prod-unsafe as-is: `POSTGRES_PASSWORD: boutique`, Postgres published to
  the host (`5433:5432`), localhost-only `CORS_ORIGINS`, `SEED_ON_START=true`, no
  `restart:` policy, `NODE_ENV` not passed.
  Fix: add `docker-compose.prod.yml` (or env file) with strong DB password, no host
  port for Postgres, real `CORS_ORIGINS` (both Amplify domains), `SEED_ON_START=false`,
  `NODE_ENV=production`, `restart: unless-stopped` on both services.
  Where: `docker-compose.yml:6-10,24-26`.

- [ ] **5. Rate limiting on auth (and a sane global limit)** ⚠
  Zero throttling anywhere — `/api/auth/login` and `/register` are open to credential
  brute-force and enumeration; no account lockout.
  Fix: per-IP rate limit middleware (strict on auth routes, generous globally).
  Where: `backend/src/routes/auth.routes.ts`, `backend/src/app.ts`.

## P0 — Deploy blockers ⚠

- [ ] **6. SPA rewrite rules for both Amplify apps** ⚠
  Both SPAs use `BrowserRouter`; without the rewrite-to-index.html rule every deep link
  and browser refresh 404s. `amplify.yml` only documents it as a manual console step.
  Fix: add the rewrite rule per app in the Amplify console (or codify it), for both
  `frontend` and `admin`.
  Where: `amplify.yml` (header comment), `frontend/src/App.tsx`, `admin/src/main.tsx`.

- [ ] **7. Legal/compliance pages + real contact details** ⚠
  Razorpay merchant activation requires live URLs for Privacy Policy, Terms &
  Conditions, Refund/Cancellation Policy, and Shipping Policy — none exist as routes
  (only FAQ accordions in Client Care). Contact details are placeholders: `href="#"`
  email/phone/socials, `+91 90000 00000`.
  Fix: add `/privacy`, `/terms`, `/refund-policy`, `/shipping-policy` routes with real
  content; put the atelier's real email/phone/socials in Contact + Footer.
  Where: `frontend/src/App.tsx`, `frontend/src/pages/Contact.tsx`,
  `frontend/src/components/Footer.tsx`, `frontend/src/pages/ClientCare.tsx`.

- [ ] **8. `VITE_API_URL` set per Amplify app — and fail loud when missing** ⚠
  Both SPAs silently fall back to `http://localhost:3001` if the build-time var is
  forgotten — the deployed site "works" until every API call fails.
  Fix: set `VITE_API_URL` in each Amplify app's env; make production builds fail when
  it's unset instead of falling back.
  Where: `frontend/src/lib/api.ts:5-6`, `admin/src/lib/api.ts:1-2`, `amplify.yml`.

## P1 — Hardening & ops

- [ ] **9. Security headers** — none anywhere. Add hono `secureHeaders` on the API and
  Amplify `customHeaders` (CSP, HSTS, X-Frame-Options, X-Content-Type-Options,
  Referrer-Policy) for both SPAs. Where: `backend/src/app.ts:70`, `amplify.yml`.

- [ ] **10. Request body size limit** — unbounded JSON bodies can exhaust memory. Add
  hono `bodyLimit`. Where: `backend/src/app.ts`.

- [ ] **11. Structured + request logging** — only 9 raw `console.*` calls; no access
  log, no request IDs, 500s can't be correlated. Add pino or `hono/logger` with request
  IDs. Where: `backend/src/app.ts:65`, `backend/src/index.ts:44-49`.

- [ ] **12. DB pool config for managed Postgres** — only `max: 10` is set; no
  `connectionTimeoutMillis`, `idleTimeoutMillis`, statement timeout, or `ssl` option
  (most managed PG requires TLS). Where: `backend/src/db.ts:5`.

- [ ] **13. JWT lifecycle** — 7-day tokens with no revocation/refresh: a demoted or
  disabled admin keeps access up to 7 days. Shorten expiry and/or add a revocation
  check on role-sensitive routes. Where: `backend/src/services/auth.service.ts:34,55`,
  `backend/src/middleware/auth.ts:17`.

- [ ] **14. Readiness endpoint + container health/non-root** — `/api/health` never
  touches the DB (a LB would route to an instance with a dead DB); Dockerfile has no
  `HEALTHCHECK` and runs as root. Add `/api/ready` that pings the pool, a Dockerfile
  `HEALTHCHECK`, and a non-root `USER`. Where: `backend/src/app.ts:72`,
  `backend/Dockerfile`.

- [ ] **15. Migration advisory lock** — `migrate()` runs on every boot; with >1 API
  replica, instances race to apply migrations. Add a Postgres advisory lock, or
  document a single-instance constraint. Where: `backend/src/index.ts:21`,
  `backend/src/migrate.ts:6-33`.

- [ ] **16. DB backups** — `dbdata` is a plain volume; no pg_dump/snapshot mechanism
  exists (README just says "use a managed volume/backup"). Script a pg_dump cron (or
  use volume snapshots) with retention + a tested restore. Where: `docker-compose.yml:34-35`.

- [ ] **17. React error boundary in both SPAs** — any render exception is a white
  screen with no recovery UI. Where: `frontend/src/main.tsx`, `admin/src/main.tsx`.

- [ ] **18. Storefront SEO basics** — `index.html` has a title only: no meta
  description, OG/Twitter tags, canonical, favicon, robots.txt, or sitemap (no
  `public/` dir at all). Where: `frontend/index.html`.

- [ ] **19. Admin `noindex`** — the admin SPA is indexable by search engines. Add
  `<meta name="robots" content="noindex">` (and/or robots.txt disallow).
  Where: `admin/index.html`.

- [ ] **20. CI pipeline** — no `.github/` exists; nothing runs tests before a deploy
  (Amplify only builds). Add GitHub Actions: typecheck + unit tests (backend 90,
  frontend 18, admin 9) + builds on PR. Where: new `.github/workflows/ci.yml`.

- [ ] **21. Contact form is fake** — `onSubmit` just flips local state and shows
  "request received"; nothing is sent anywhere. Wire it to the API/email (see #22) or
  remove the form. Where: `frontend/src/pages/Contact.tsx`.

- [ ] **22. Transactional email** — not implemented; order confirmation is on-screen
  only. Pick a provider (SES / Resend / Postmark), send on order paid + status changes.

- [ ] **23. Google OAuth client ID** — flow fully wired but dormant. Create an OAuth
  2.0 Web client in Google Cloud Console (authorized origins: localhost:5173 + prod
  origin); set `GOOGLE_CLIENT_ID` (backend) and `VITE_GOOGLE_CLIENT_ID` (storefront
  build) — same value. Until then: backend 503s on `/api/auth/google`, button shows
  "setup pending". Apple Sign-In stays visual-only (needs Apple Developer account).

- [ ] **24. Product photography + image hosting** — products render the celadon
  placeholder when `image_url` is null. Shoot catalog + campaign imagery, host on
  S3+CloudFront (code only needs URLs), populate `products.image_url` via the admin app.
  Where: `frontend/src/components/ImageSlot.tsx:10`.

- [ ] **25. Domain, DNS, TLS** — domain for storefront/admin/api; certs via ACM (AWS)
  or Let's Encrypt; TLS-terminating proxy (Caddy/nginx/ALB) in front of the API.

- [ ] **26. Execute deployment** — storefront + admin → Amplify Hosting (two apps from
  `amplify.yml`, each with env vars from #8/#23 and the rewrite from #6); backend
  api+postgres → EC2 via the prod compose overlay (#4); backend `CORS_ORIGINS` must
  include both Amplify domains.

- [ ] **34. Socials link-in-bio page: real content + prod config** *(added 2026-07-06
  from PR #2, `feat/socials-linktree` — was §8 of the old TODO-THIRD-PARTY.md)* —
  `socials/src/config.ts` ships guessed placeholders; before printing any QR codes:
  replace website / "Book an Appointment" URL (currently `https://tanviagnihotry.com`,
  pending #25); verify or register the Instagram handle (`@tanviagnihotry` is guessed);
  replace the WhatsApp/phone placeholder (`+91 90000 00000`); add the socials production
  origin to backend `CORS_ORIGINS` (or scan logging is CORS-blocked); set
  `VITE_SOCIALS_URL` on the admin Amplify app so generated QRs point at production. Once
  PR #2 merges, deployment item #26 gains a third Amplify app (`socials`).

## P2 — Post-launch / nice-to-have

- [ ] **27. Password reset flow** — none exists; blocked on email (#22).

- [ ] **28. Password policy** — register enforces only `min(8)`; consider length/
  breached-password checks and a bcrypt max-length cap; bcrypt cost 10 is acceptable
  but low. Where: `backend/src/routes/auth.routes.ts:11`,
  `backend/src/services/auth.service.ts:66`.

- [ ] **29. Shutdown timeout + resource limits** — graceful shutdown has no forced-exit
  timer (a hung connection blocks SIGTERM); compose has no mem/cpu limits.
  Where: `backend/src/index.ts:52-59`, `docker-compose.yml`.

- [ ] **30. Accessibility fixes** — checkout delivery/payment options are clickable
  `<div>`s (not radio inputs); PDP size selector is an unnamed button group; size-guide
  trigger is a `<span onClick>`. Where: `frontend/src/pages/Checkout.tsx`,
  `frontend/src/pages/Product.tsx`.

- [ ] **31. Analytics + monitoring** — web analytics for the storefront; uptime/log
  monitoring for the API containers.

- [ ] **32. Decorative UI: wire or remove** — newsletter form (local state only),
  cart promo-code field (no handler), dead card-number/expiry/CVV inputs on checkout
  (the mock modal is the real path), Apple sign-in button ("coming soon").
  Where: `frontend/src/pages/Home.tsx:241-263`, `frontend/src/pages/CartPage.tsx:92`,
  `frontend/src/pages/Checkout.tsx:409-429`, `frontend/src/pages/Login.tsx:297-302`.

- [ ] **33. e2e in CI** — Playwright assumes a hand-started localhost stack (no
  `webServer` block); orchestrate the stack in CI to run the 8 e2e specs.
  Where: `e2e/playwright.config.ts`, `scripts/verify-api.sh`.

---

### What's already solid (verified in the audits — no action needed)

SQL fully parameterized (whitelisted ORDER BY, regex-gated UUIDs) · checkout stock
decrement under `SELECT … FOR UPDATE` in a transaction, backstopped by
`CHECK (stock >= 0)` · order status state machine with cancel-restock · server-authoritative
pricing · email uniqueness at three layers · graceful shutdown (SIGTERM → server close →
pool end) · tracked, transactional migrations · spec §4/§5 API contract fully implemented ·
admin SPA safe to serve publicly (authorization is backend-enforced; no secrets bundled).
