# Fashion Boutique Platform — Design Spec

Date: 2026-07-05 · Status: approved (stack decisions confirmed by Sarthak: Hono, PostgreSQL, INR, guest checkout allowed)

## 1. What we're building

A complete e-commerce platform for the **Tanvi Agnihotry** Indo-Western couture boutique
(design language imported from Claude Design → `design-reference/`, distilled in
`design-reference/DESIGN-NOTES.md`):

1. **Storefront** (`frontend/`) — React (Vite + TS) customer app implementing the reference
   screens exactly; mobile-first (90% of customers are on mobile).
2. **Backend** (`backend/`) — containerized TypeScript API. Clear app-layer / data-layer
   segregation. App layer = Hono HTTP + services; data layer = PostgreSQL container +
   repository modules (only place SQL lives). Cloud-portable: plain containers, no
   AWS-specific services.
3. **Admin** (`admin/`) — React (Vite + TS) app in the same design language: inventory
   management, active orders, payments.
4. **E2E** (`e2e/`) — Playwright integration suite driving the storefront against the real
   containerized backend.

Out of scope for this run: actual AWS deployment (Amplify + EC2 come later), real Razorpay
keys (masked/mocked), real product photography, transactional email.

## 2. Confirmed decisions

| Decision | Choice | Why |
|---|---|---|
| Backend framework | **Hono** (@hono/node-server) | User's standard; tiny, TS-first, portable |
| Database | **PostgreSQL 16** (official container) | Relational fits orders/stock; runs on any cloud |
| Currency | **INR**, stored in **paise** (integers) | Razorpay is India-first; design shows ₹ en-IN format |
| Checkout | **Guest allowed** + optional accounts (JWT) | Confirmed by user |
| Payments | **Masked Razorpay** behind a `PaymentProvider` interface | No account yet; swap-in later |
| Auth tokens | JWT HS256 via `hono/jwt`, bcryptjs hashes | No third-party IdP; portable |
| Validation | zod + @hono/zod-validator | Standard, thin |
| Frontend state | React Context (cart in localStorage, auth token in localStorage) | No Redux/react-query bloat |
| Routing | react-router-dom v6 | Battle-tested |
| Unit tests | Vitest everywhere; RTL for React; `app.request()` for Hono routes | One test runner |
| E2E | Playwright | Real-browser flow incl. mobile viewport |
| Monorepo | Independent packages (no workspace hoisting) | Docker builds & Amplify appRoot stay simple |

## 3. Non-goals / anti-bloat rules

- No ORM (plain `pg` with SQL in repositories), no DI framework, no microservices.
- No server-side cart (cart is client state; server validates and prices at order creation).
- No inventory reservation queue — stock is checked & decremented transactionally at order
  creation; cancelled orders restock.
- Admin auth = same users table with `role='admin'` (seeded admin), no RBAC framework.

## 4. Data model (PostgreSQL)

users(id uuid PK, email unique, password_hash, first_name, last_name,
      role 'customer'|'admin', created_at)
categories(id uuid PK, slug unique, name, description, position)
products(id uuid PK, category_id FK, slug unique, name, description, details,
         price int paise, color, flag null|'bestseller'|'new', image_url null,
         active bool, created_at)
product_variants(id uuid PK, product_id FK, size, stock int ≥0, UNIQUE(product_id,size))
orders(id uuid PK, order_number 'TA-2026-NNNNN' unique, user_id FK null (guest),
       email, phone, first_name, last_name, address_line1, address_line2, city, state,
       pincode, country, delivery_method 'standard'|'priority', delivery_fee int,
       subtotal int, total int,
       status 'pending_payment'|'paid'|'in_atelier'|'quality_check'|'dispatched'|
              'delivered'|'cancelled', created_at, updated_at)
order_items(id uuid PK, order_id FK, product_id, variant_id, product_name, size, color,
            unit_price int, quantity int, image_url)
payments(id uuid PK, order_id FK, provider 'razorpay_mock', provider_order_id,
         provider_payment_id, amount int, currency 'INR',
         status 'created'|'captured'|'failed'|'refunded', method, created_at, updated_at)
wishlists(user_id FK, product_id FK, created_at, PK(user_id, product_id))

Rules: prices/totals computed **server-side** from DB prices at order creation. Priority
delivery fee ₹2,500 (250000 paise), standard complimentary. Stock decremented in the same
transaction as order+items insert; `cancelled` restores stock. Payment success →
order `paid`; failure → order stays `pending_payment` (retryable).

## 5. API contract (`/api`, JSON; money in paise)

Public: `GET /health` · `POST /auth/register` · `POST /auth/login` (→ `{token,user}`) ·
`GET /auth/me` · `GET /categories` · `GET /products?category&search&sort&page&limit` (→
`{items,total,page,pages}`, sort = featured|new|price_asc|price_desc) ·
`GET /products/:slug` (→ detail + variants + related) ·
`POST /orders` (guest or Bearer; `{customer{email,phone,firstName,...,pincode,country},
deliveryMethod, items:[{variantId,quantity}]}` → order w/ orderNumber) ·
`GET /orders/:orderNumber?email=` (guest tracking) ·
`POST /payments/checkout` `{orderId}` → `{paymentId, providerOrderId, keyId:"rzp_test_MASKED",
amount, currency, mock:true}` · `POST /payments/confirm` `{paymentId,
outcome:'success'|'failure'}` (mock of the Razorpay handler+webhook).
Bearer-only: `GET /me/orders` · `GET/PUT/DELETE /me/wishlist(/:productId)`.
Admin (`role=admin`): `GET /admin/summary` · `GET/POST /admin/products` ·
`PUT /admin/products/:id` · `PATCH /admin/variants/:id {stock}` · `GET /admin/orders?status` ·
`PATCH /admin/orders/:id {status}` · `GET /admin/payments`.
Errors: `{error: string}` with 400/401/403/404/409 (409 = insufficient stock, duplicate email).

## 6. Payment masking (Razorpay)

`PaymentProvider` interface in `backend/src/services/payments.service.ts`:
`createProviderOrder(amountPaise, receipt) → {providerOrderId}`;
`MockRazorpayProvider` returns `order_MOCK<random>` / accepts any confirm.
Frontend checkout opens an in-app **"Razorpay · Test Mode"** modal (design-language styled,
clearly labeled masked) with Pay / Fail buttons → calls `/payments/confirm`.
Real integration steps documented in `TODO-THIRD-PARTY.md` (env keys, checkout.js script,
signature verification, webhook).

## 7. Design fidelity

- Port `brand.css` + `shop.css` tokens/components 1:1 into both React apps.
- Every storefront page maps to a reference screen (see DESIGN-NOTES.md crib sheet).
- Admin has no reference screens → extend the language: ink/celadon palette, Bodoni headings,
  Jost UI chrome, hairline tables, gold accents, same buttons/forms/badges.
- Images: `<ImageSlot>` renders real `<img>` when URL exists, else celadon-gradient
  placeholder with sage caps label (exactly the design-tool empty state).
- Behaviors: scroll reveal, nav solid-on-scroll, cart drawer, toast, mobile hamburger
  overlay, magnetic buttons + parallax (pointer:fine only), reduced-motion respected.

## 8. Runtime topology (local = future EC2 shape)

docker-compose: `db` (postgres:16-alpine, volume, healthcheck) + `api` (multi-stage
node:22-alpine image, runs SQL migrations + idempotent seed on boot, port 3001).
Frontend dev :5173, admin dev :5174, `VITE_API_URL` points at :3001. CORS allows both.
Amplify build spec (`amplify.yml`, appRoot `frontend`) committed for later; SPA rewrite
documented in README.

## 9. Acceptance criteria (from the brief)

1. Storefront matches the reference design exactly; mobile-friendly; RTL test suite green;
   `npm run build` succeeds (Amplify-ready).
2. Backend builds; Docker image builds and is deploy-ready; unit tests cover all services;
   containers run locally and every API verified by hand (curl) with intended behavior;
   test containers cleaned up afterwards.
3. Admin app: inventory CRUD + stock, active orders w/ status updates, payments list; same
   testing/build bar as storefront.
4. E2E: full stack locally, Playwright drives browse → PDP → bag → guest & account checkout
   → masked payment → confirmation → order + payment visible in admin → status update.
5. Docs: README (run everything), TODO-THIRD-PARTY.md (Razorpay keys, photography, email,
   analytics, domain).
