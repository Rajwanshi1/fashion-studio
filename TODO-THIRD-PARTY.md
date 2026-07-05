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

## 2. Product photography / image hosting
Products currently render the on-brand celadon placeholder (design's image-slot look) when
`image_url` is null.
- [ ] Real photography for catalog + campaign (hero, lookbook, categories)
- [ ] Host on S3 + CloudFront (or any object storage — code only needs URLs)
- [ ] Populate `products.image_url` via admin app

## 3. Transactional email (order confirmations, atelier updates)
Not implemented — order confirmation is on-screen only.
- [ ] Pick provider (SES / Resend / Postmark), add keys, send on order paid + status changes

## 4. Domain, DNS, TLS
- [ ] Domain for storefront/admin/api; TLS certs (ACM on AWS or Let's Encrypt on EC2)

## 5. Analytics / monitoring (optional, later)
- [ ] Web analytics for the storefront; uptime/log monitoring for the API containers

## 6. Deployment (explicitly out of scope this run)
- [ ] Frontend + admin → AWS Amplify Hosting (build spec committed in `amplify.yml`)
- [ ] Backend containers (api + postgres) → EC2 via docker compose (portable to any cloud)
