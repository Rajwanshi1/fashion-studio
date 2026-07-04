# Fashion Boutique Platform Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> Execution note (this session): executed inline by the main agent with TDD per task;
> contracts below are binding — code lives once in the repo, not duplicated here.
> Spec: `docs/superpowers/specs/2026-07-05-fashion-boutique-design.md`.
> Design QA source of truth: `design-reference/` + `DESIGN-NOTES.md`.

**Goal:** Ship the Tanvi Agnihotry boutique: containerized Hono+Postgres marketplace API, pixel-faithful React storefront, React admin, all tested unit→API→E2E, Razorpay masked.

**Architecture:** Three independent packages + compose file. Backend separates HTTP routes → services (business rules) → repositories (SQL) so the data layer container (Postgres) and app layer container (API) deploy to any cloud. Frontends are static SPA builds calling `/api` (VITE_API_URL).

**Tech Stack:** Hono 4 / @hono/node-server / pg / zod / hono-jwt / bcryptjs · Vite + React 18 + react-router-dom 6 · Vitest + Testing Library · Playwright · Docker Compose (postgres:16-alpine, node:22-alpine).

## Global Constraints

- Money is integer paise everywhere in backend + API; UI formats `'₹' + (paise/100).toLocaleString('en-IN')`.
- No AWS-coupled code anywhere in backend/frontends. Containers only.
- Data layer = `backend/src/data/*` (only files allowed to contain SQL) + Postgres container. Services never import `pg`.
- Design tokens come only from ported `brand.css`/`shop.css` custom properties — no ad-hoc hex values in components.
- No `dangerouslySetInnerHTML` / `innerHTML` in React code.
- Every package: `npm run build` green, `npm test` green before its task is complete.
- Commit after each task with a conventional message.

---

### Task 1: Monorepo scaffold
**Files:** Create `backend/`, `frontend/`, `admin/`, `e2e/` package skeletons (package.json, tsconfig), root `README.md`, `.gitignore`, `docker-compose.yml` (db+api stubs), `amplify.yml`, `TODO-THIRD-PARTY.md`.
**Produces:** Ports/env conventions — API `:3001`, frontend `:5173`, admin `:5174`, Postgres host `:5433→5432`; env `DATABASE_URL`, `JWT_SECRET`, `CORS_ORIGINS`, `SEED_ON_START`, `VITE_API_URL`.
- [x] Scaffold + `git commit`

### Task 2: DB schema, migrations runner, seed
**Files:** `backend/db/migrations/001_schema.sql`, `backend/db/seed.sql`, `backend/src/db.ts` (pg Pool), `backend/src/migrate.ts` (applies `db/migrations/*.sql` once, tracked in `schema_migrations`; optional idempotent seed when `SEED_ON_START=true` and products table empty).
**Produces:** Schema exactly per spec §4. Seed: 5 categories, 16 products across categories (INR paise prices ₹96,000–₹2,48,000 range, names/colors/flags from design copy), variants XS–XL+Custom with stock, admin user `admin@tanviagnihotry.com` / `TanviAdmin@2026` (bcrypt), demo customer `aanya@example.com` / `Aanya@2026`.
- [x] Write DDL + seed; migration runner; verified against dockerized Postgres.

### Task 3: Domain types, repositories (data layer)
**Files:** `backend/src/types.ts`, `backend/src/data/{products,users,orders,payments}.repo.ts`.
**Interfaces (consumed by services):**
- `ProductsRepo`: `listCategories()`, `listProducts(filter:{categorySlug?,search?,sort?,page,limit})→{items,total}`, `getBySlug(slug)`, `getRelated(productId,categoryId,limit)`, `getVariantsForUpdate(client,variantIds)`, `decrementStock(client,variantId,qty)`, `restock(client,variantId,qty)`, admin CRUD (`createProduct`, `updateProduct`, `setVariantStock`, `listAllProducts`).
- `UsersRepo`: `create`, `findByEmail`, `findById`.
- `OrdersRepo`: `createWithItems(client,order,items)`, `getByNumber`, `getById`, `listByUser`, `listAdmin(status?)`, `updateStatus`, `nextOrderNumber(client)`.
- `PaymentsRepo`: `create`, `getById`, `updateStatus`, `listAdmin`, `getByOrderId`.
- `WishlistRepo` (inside products.repo or own): `list(userId)`, `add`, `remove`.
All repos take a `Pool`/`PoolClient`; transactions orchestrated by services via `withTransaction(pool, fn)` helper in `db.ts`.
- [x] Implement; unit-smoke via fakes contract test.

### Task 4: Services (app layer) + unit tests — TDD
**Files:** `backend/src/services/{auth,catalog,orders,payments}.service.ts`, `backend/test/fakes.ts`, `backend/test/{auth,catalog,orders,payments}.service.test.ts`.
**Produces:**
- `AuthService`: `register`, `login`, `getUser`; errors `EMAIL_TAKEN`, `INVALID_CREDENTIALS`; JWT sign/verify (`hono/jwt`), payload `{sub,email,role,exp:7d}`.
- `CatalogService`: passthrough + input normalization; search matches name/description/color.
- `OrdersService.createOrder(input)`: validates items non-empty, loads variants w/ lock, 409 `INSUFFICIENT_STOCK`, prices from DB, delivery fee standard 0 / priority 250000, `TA-2026-XXXXX` number, decrements stock atomically. `cancel` restocks. `updateStatus` validates transition map.
- `PaymentsService`: `checkout(orderId)` → payment row `created` + `providerOrderId` from `PaymentProvider` (`MockRazorpayProvider`); `confirm(paymentId,outcome)` → captured+order paid | failed. Idempotent: confirming a captured payment returns it unchanged.
Tests: happy paths + stock conflict, bad credentials, guest vs user orders, idempotent confirm, cancel restock, status transitions.
- [x] Red → green → commit.

### Task 5: HTTP routes + middleware + API tests
**Files:** `backend/src/app.ts` (createApp(deps)), `backend/src/routes/*.ts`, `backend/src/middleware/auth.ts`, `backend/src/config.ts`, `backend/src/index.ts`, `backend/test/api.test.ts`.
**Produces:** API exactly per spec §5, zod-validated, CORS from env. `createApp({pool?, repos?, provider?})` accepts fakes so API tests run without Postgres via `app.request()`.
- [x] Tests for every endpoint group incl. auth guards (401/403) → green → commit.

### Task 6: Backend containerization + live API verification
**Files:** `backend/Dockerfile` (multi-stage), `backend/.dockerignore`, final `docker-compose.yml`.
- [x] `docker compose up -d --build` → healthchecks green.
- [x] curl verification script of every endpoint (register/login/browse/order/pay-mock/admin flows) with expected status codes; recorded in `docs/verification/backend-api.md`.
- [x] `docker compose down` (containers cleaned; named volume kept for E2E task) + commit.

### Task 7: Storefront shell + design system port
**Files:** `frontend/` Vite app; `src/styles/{brand.css,shop.css}` ported (image-slot styling → `.img-slot` class); `src/lib/{api.ts,format.ts,cart.tsx,auth.tsx,wishlist.tsx}`; `src/components/{Ticker,Nav,MobileNav,Footer,CartDrawer,Toast,ImageSlot,ProductCard,Reveal,Price}.tsx`; router in `App.tsx` with all routes + 404.
**Produces:** `useCart()` (`items:[{variantId,productSlug,name,size,color,unitPrice,qty,imageUrl}]`, add/remove/setQty/clear/subtotal, localStorage `ta.cart`), `useAuth()` (`token,user,login,register,logout`, localStorage `ta.auth`), `api.get/post` with token header, `formatINR(paise)`.
- [x] Component tests (cart math, formatINR, Nav bag count) green → commit.

### Task 8: Storefront pages (design-exact)
**Files:** `src/pages/{Home,Collections,Collection,Product,CartPage,Checkout,OrderConfirmation,Login,Account,Wishlist,Search,Lookbook,TheHouse,ClientCare,Contact,SizeGuide,NotFound}.tsx` (+ page CSS colocated).
Per-page layout cribs in DESIGN-NOTES.md §"Page layout cribs" — match reference HTML structure/classes closely. Checkout embeds masked Razorpay modal (Test Mode label, Pay/Fail). Wishlist: localStorage for guests, server-synced for logged-in.
- [x] RTL tests: home renders sections, PLP filters/sort call API, PDP add-to-bag, checkout guest flow w/ mocked API + mock-pay success → navigates to confirmation, 404. Green.
- [x] `npm run build` green (Amplify-ready) → commit.

### Task 9: Admin app
**Files:** `admin/` Vite app reusing ported tokens; `src/pages/{Login,Dashboard,Products,ProductEdit,Orders,Payments}.tsx`; `src/lib/{api.ts,auth.tsx}`; components `{StatusBadge,DataTable,StatCard}`.
**Produces:** login (admin role required), dashboard summary cards, product list + create/edit form (fields incl. variants stock editor), orders table w/ status select (transition-valid options), payments table. Same design language (ink sidebar, celadon canvas, Bodoni headings).
- [x] RTL tests (login guard, products table renders, status update calls API) + build green → commit.

### Task 10: E2E integration (full stack)
**Files:** `e2e/package.json`, `e2e/playwright.config.ts` (chromium desktop + Pixel 7 mobile project), `e2e/tests/{storefront.spec.ts,admin.spec.ts}`.
- [x] Stack up: compose (db+api, fresh seed) + `vite preview` frontend + admin.
- [x] Storefront spec: home → collection → PDP → add to bag → drawer → cart → guest checkout → mock pay → confirmation shows TA- number; account flow: register → order → my orders lists it; wishlist.
- [x] Admin spec: login → order visible paid → advance status → stock edit reflects on PDP.
- [x] All green on desktop + mobile projects; `docker compose down` cleanup → commit.

### Task 11: Design-fidelity QA pass
- [x] Serve `design-reference/` statically; side-by-side screenshot comparison (Chrome tooling) of Homepage + key screens vs app at 390px and 1440px; fix deviations.

### Task 12: Docs + final cleanup
- [x] README (architecture map, run/test instructions per package, deployment notes: Amplify for frontends, EC2 containers for backend), TODO-THIRD-PARTY.md finalized, `docker ps -a` clean, final commit.
