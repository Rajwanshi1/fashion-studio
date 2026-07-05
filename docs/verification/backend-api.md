# Backend API — Live Container Verification

Date: 2026-07-05 · Image: `fashion-studio-api` (sha256:43c5ac5da7d2…, node:22-alpine multi-stage) · Stack: docker compose (`boutique-db` postgres:16-alpine on :5433, `boutique-api` on :3001, migrated + seeded). Verified by running `scripts/verify-api.sh` with GNU bash + curl inside the api container (`docker exec -e API=http://localhost:3001 boutique-api bash /tmp/verify-api.sh`) against the live Postgres data path — covering health, catalog listing/filter/search/sort/detail/404, auth (register 201, duplicate 409, bad password 401, admin login, /auth/me guards), guest orders (create 201, tracking email rules, empty-items 400, insufficient-stock 409), masked Razorpay (checkout, confirm success, idempotent confirm, order → paid), customer orders + wishlist CRUD, and admin (401/403 guards, summary, product create/update, order status transitions incl. invalid-transition 400, payments listing). Note: the script must be run with a shell that preserves quoting faithfully (real bash); shells that brace-expand the JSON `-d` bodies send garbage requests and produce false failures.

## Output

```

== health ==
PASS  GET /api/health (200)
== catalog ==
PASS  GET /api/categories (200)
PASS  GET /api/products (200)
PASS  GET /api/products?category=lehenga-sets (200)
PASS  GET /api/products?search=sage (200)
PASS  GET /api/products?sort=price_asc (200)
PASS  GET /api/products/:slug (200)
PASS  GET /api/products/nope-404 (404)
== auth ==
PASS  register (201)
PASS  register duplicate -> 409 (409)
PASS  login bad password -> 401 (401)
PASS  login admin (200)
PASS  GET /api/auth/me (200)
PASS  GET /api/auth/me no token -> 401 (401)
== orders (guest) ==
PASS  POST /api/orders guest (201)
PASS  order lookup with email (200)
PASS  order lookup wrong email -> 404 (404)
PASS  POST /api/orders empty items -> 400 (400)
PASS  POST /api/orders stock 409 (409)
== payments (masked razorpay) ==
PASS  POST /api/payments/checkout (200)
PASS  POST /api/payments/confirm success (200)
PASS  confirm idempotent (200)
PASS  order now paid (paid)
== user orders + wishlist ==
PASS  GET /api/me/orders (200)
PASS  PUT /api/me/wishlist/:id (200)
PASS  GET /api/me/wishlist (200)
PASS  DELETE /api/me/wishlist/:id (200)
== admin ==
PASS  admin summary (no token) -> 401 (401)
PASS  admin summary (customer) -> 403 (403)
PASS  admin summary (200)
PASS  admin products (200)
PASS  admin orders (200)
PASS  admin payments (200)
PASS  admin create product (201)
PASS  admin update product (200)
PASS  admin order -> in_atelier (200)
PASS  admin invalid transition -> 400 (400)

RESULT: 37 passed, 0 failed
```
