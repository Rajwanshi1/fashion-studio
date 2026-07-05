# Third-Party Services — Setup TODOs

Things that need real accounts/credentials before production. Everything below is currently
masked or stubbed so the platform works end-to-end without them.

## 1. Razorpay (payments) — MASKED
Currently `MockRazorpayProvider` in `backend/src/services/payments.service.ts` and a
"Razorpay · Test Mode" modal in the storefront checkout simulate the full flow.

> **SECURITY — BLOCKING FOR GO-LIVE:** in mock mode `POST /api/payments/confirm` trusts a
> client-supplied `outcome` field. That is acceptable ONLY while no real payments exist.
> The Razorpay integration below MUST replace it with server-side signature verification
> (`HMAC_SHA256(razorpay_order_id + "|" + razorpay_payment_id, key_secret)`) and a
> signature-verified webhook. Never ship to production with the mock provider enabled —
> gate it: refuse to boot with `PAYMENT_PROVIDER=mock` when `NODE_ENV=production`.

To go live:
- [ ] Create Razorpay account, get `RAZORPAY_KEY_ID` + `RAZORPAY_KEY_SECRET`
- [ ] Implement `RazorpayProvider` (create order via Orders API, verify payment signature
      `HMAC_SHA256(order_id|payment_id, secret)`), select provider via env
- [ ] Frontend: load `https://checkout.razorpay.com/v1/checkout.js` and open real Checkout
      instead of the mock modal (component: `frontend/src/components/RazorpayMock.tsx`)
- [ ] Add webhook endpoint + secret for async payment capture events
- [ ] Enable COD rules / UPI as desired in Razorpay dashboard

## 2. Google Sign-In — WIRED, AWAITING CLIENT ID
The full flow is implemented (storefront GIS button → POST /api/auth/google → ID-token
verification against Google JWKS → account upsert). It stays dormant until configured:
- [ ] Create an OAuth 2.0 Client ID (type "Web application") in Google Cloud Console →
      APIs & Services → Credentials (free; add http://localhost:5173 and your production
      origin to "Authorized JavaScript origins")
- [ ] Set `GOOGLE_CLIENT_ID` on the backend (docker-compose env) and
      `VITE_GOOGLE_CLIENT_ID` for the storefront build — same value
- [ ] Until then: backend returns 503 for /api/auth/google; the storefront button shows
      "Google sign-in — setup pending"
Apple Sign-In remains visual-only (needs an Apple Developer account; add later if wanted).

## 3. Product photography / image hosting
Products currently render the on-brand celadon placeholder (design's image-slot look) when
`image_url` is null.
- [ ] Real photography for catalog + campaign (hero, lookbook, categories)
- [ ] Host on S3 + CloudFront (or any object storage — code only needs URLs)
- [ ] Populate `products.image_url` via admin app

## 4. Transactional email (order confirmations, atelier updates)
Not implemented — order confirmation is on-screen only.
- [ ] Pick provider (SES / Resend / Postmark), add keys, send on order paid + status changes

## 5. Domain, DNS, TLS
- [ ] Domain for storefront/admin/api; TLS certs (ACM on AWS or Let's Encrypt on EC2)

## 6. Analytics / monitoring (optional, later)
- [ ] Web analytics for the storefront; uptime/log monitoring for the API containers

## 7. Deployment (explicitly out of scope this run)
- [ ] Frontend + admin → AWS Amplify Hosting (build spec committed in `amplify.yml`)
- [ ] Backend containers (api + postgres) → EC2 via docker compose (portable to any cloud)
