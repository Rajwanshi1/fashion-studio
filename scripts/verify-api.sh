#!/usr/bin/env bash
# Live API verification against the dockerized stack (docker compose up -d --build first).
# Exercises every endpoint group and asserts HTTP status codes.
set -u
API="${API:-http://localhost:3001}"
PASS=0; FAIL=0
TS="$(date +%s)"
GUEST_EMAIL="guest${TS}@example.com"
NEW_USER_EMAIL="test${TS}@example.com"

check () { # check <name> <expected_status(s) pipe-separated> <actual_status>
  case "|$2|" in *"|$3|"*) PASS=$((PASS+1)); echo "PASS  $1 ($3)";;
  *) FAIL=$((FAIL+1)); echo "FAIL  $1 (expected $2, got $3)";; esac
}
code () { curl -s -o /tmp/vapi_body -w '%{http_code}' "$@"; }
body () { cat /tmp/vapi_body; }
jqget () { node -e "const d=JSON.parse(require('fs').readFileSync('/tmp/vapi_body','utf8')); const v=$1; console.log(typeof v==='object'?JSON.stringify(v):v)"; }

echo "== health =="
check "GET /api/health" 200 "$(code $API/api/health)"

echo "== catalog =="
check "GET /api/categories" 200 "$(code $API/api/categories)"
check "GET /api/products" 200 "$(code $API/api/products)"
check "GET /api/products?category=lehenga-sets" 200 "$(code "$API/api/products?category=lehenga-sets")"
check "GET /api/products?search=sage" 200 "$(code "$API/api/products?search=sage")"
check "GET /api/products?sort=price_asc" 200 "$(code "$API/api/products?sort=price_asc")"
code "$API/api/products?limit=1" >/dev/null
SLUG=$(jqget "d.items[0].slug")
check "GET /api/products/:slug" 200 "$(code "$API/api/products/$SLUG")"
VARIANT_ID=$(jqget "d.variants.find(v=>v.stock>1).id")
check "GET /api/products/nope-404" 404 "$(code $API/api/products/nope-404)"

echo "== auth =="
check "register" "200|201" "$(code -X POST $API/api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$NEW_USER_EMAIL\",\"password\":\"Passw0rd!\",\"firstName\":\"Test\",\"lastName\":\"User\"}")"
TOKEN=$(jqget "d.token")
check "register duplicate -> 409" 409 "$(code -X POST $API/api/auth/register -H 'content-type: application/json' -d "{\"email\":\"$NEW_USER_EMAIL\",\"password\":\"Passw0rd!\",\"firstName\":\"T\",\"lastName\":\"U\"}")"
check "login bad password -> 401" 401 "$(code -X POST $API/api/auth/login -H 'content-type: application/json' -d "{\"email\":\"$NEW_USER_EMAIL\",\"password\":\"wrong\"}")"
check "login admin" 200 "$(code -X POST $API/api/auth/login -H 'content-type: application/json' -d '{"email":"admin@tanviagnihotry.com","password":"TanviAdmin@2026"}')"
ADMIN_TOKEN=$(jqget "d.token")
check "GET /api/auth/me" 200 "$(code $API/api/auth/me -H "authorization: Bearer $TOKEN")"
check "GET /api/auth/me no token -> 401" 401 "$(code $API/api/auth/me)"

echo "== orders (guest) =="
ORDER_BODY="{\"customer\":{\"email\":\"$GUEST_EMAIL\",\"phone\":\"+91 90000 00000\",\"firstName\":\"Guest\",\"lastName\":\"Buyer\",\"addressLine1\":\"12 Sea Breeze\",\"addressLine2\":\"\",\"city\":\"Mumbai\",\"state\":\"Maharashtra\",\"pincode\":\"400026\",\"country\":\"India\"},\"deliveryMethod\":\"standard\",\"items\":[{\"variantId\":\"$VARIANT_ID\",\"quantity\":1}]}"
check "POST /api/orders guest" "200|201" "$(code -X POST $API/api/orders -H 'content-type: application/json' -d "$ORDER_BODY")"
ORDER_ID=$(jqget "d.id"); ORDER_NUMBER=$(jqget "d.orderNumber")
check "order lookup with email" 200 "$(code "$API/api/orders/$ORDER_NUMBER?email=$GUEST_EMAIL")"
check "order lookup wrong email -> 404" 404 "$(code "$API/api/orders/$ORDER_NUMBER?email=wrong@example.com")"
check "POST /api/orders empty items -> 400" 400 "$(code -X POST $API/api/orders -H 'content-type: application/json' -d "{\"customer\":{\"email\":\"$GUEST_EMAIL\",\"phone\":\"\",\"firstName\":\"G\",\"lastName\":\"B\",\"addressLine1\":\"x\",\"addressLine2\":\"\",\"city\":\"M\",\"state\":\"MH\",\"pincode\":\"400001\",\"country\":\"India\"},\"deliveryMethod\":\"standard\",\"items\":[]}")"
check "POST /api/orders stock 409" 409 "$(code -X POST $API/api/orders -H 'content-type: application/json' -d "{\"customer\":{\"email\":\"$GUEST_EMAIL\",\"phone\":\"\",\"firstName\":\"G\",\"lastName\":\"B\",\"addressLine1\":\"x\",\"addressLine2\":\"\",\"city\":\"M\",\"state\":\"MH\",\"pincode\":\"400001\",\"country\":\"India\"},\"deliveryMethod\":\"standard\",\"items\":[{\"variantId\":\"$VARIANT_ID\",\"quantity\":99999}]}")"

echo "== payments (masked razorpay) =="
check "POST /api/payments/checkout" 200 "$(code -X POST $API/api/payments/checkout -H 'content-type: application/json' -d "{\"orderId\":\"$ORDER_ID\"}")"
PAYMENT_ID=$(jqget "d.paymentId ?? d.id")
check "POST /api/payments/confirm success" 200 "$(code -X POST $API/api/payments/confirm -H 'content-type: application/json' -d "{\"paymentId\":\"$PAYMENT_ID\",\"outcome\":\"success\"}")"
check "confirm idempotent" 200 "$(code -X POST $API/api/payments/confirm -H 'content-type: application/json' -d "{\"paymentId\":\"$PAYMENT_ID\",\"outcome\":\"success\"}")"
code "$API/api/orders/$ORDER_NUMBER?email=$GUEST_EMAIL" >/dev/null
ORDER_STATUS=$(jqget "d.status")
check "order now paid" paid "$ORDER_STATUS"

echo "== user orders + wishlist =="
check "GET /api/me/orders" 200 "$(code $API/api/me/orders -H "authorization: Bearer $TOKEN")"
code "$API/api/products?limit=1" >/dev/null; PRODUCT_ID=$(jqget "d.items[0].id")
check "PUT /api/me/wishlist/:id" 200 "$(code -X PUT $API/api/me/wishlist/$PRODUCT_ID -H "authorization: Bearer $TOKEN")"
check "GET /api/me/wishlist" 200 "$(code $API/api/me/wishlist -H "authorization: Bearer $TOKEN")"
check "DELETE /api/me/wishlist/:id" 200 "$(code -X DELETE $API/api/me/wishlist/$PRODUCT_ID -H "authorization: Bearer $TOKEN")"

echo "== admin =="
check "admin summary (no token) -> 401" 401 "$(code $API/api/admin/summary)"
check "admin summary (customer) -> 403" 403 "$(code $API/api/admin/summary -H "authorization: Bearer $TOKEN")"
check "admin summary" 200 "$(code $API/api/admin/summary -H "authorization: Bearer $ADMIN_TOKEN")"
check "admin products" 200 "$(code $API/api/admin/products -H "authorization: Bearer $ADMIN_TOKEN")"
check "admin orders" 200 "$(code "$API/api/admin/orders?status=paid" -H "authorization: Bearer $ADMIN_TOKEN")"
check "admin payments" 200 "$(code $API/api/admin/payments -H "authorization: Bearer $ADMIN_TOKEN")"
check "admin create product" "200|201" "$(code -X POST $API/api/admin/products -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d "{\"categorySlug\":\"gowns\",\"name\":\"Verify Gown $TS\",\"slug\":\"verify-gown-$TS\",\"description\":\"api verification\",\"details\":\"test\",\"price\":9900000,\"color\":\"Sage\",\"flag\":null,\"imageUrl\":null,\"active\":true,\"variants\":[{\"size\":\"S\",\"stock\":3},{\"size\":\"M\",\"stock\":3}]}")"
NEW_PRODUCT_ID=$(jqget "d.id")
check "admin update product" 200 "$(code -X PUT $API/api/admin/products/$NEW_PRODUCT_ID -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"active":false}')"
# order status transitions on the paid order
check "admin order -> in_atelier" 200 "$(code -X PATCH $API/api/admin/orders/$ORDER_ID -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"status":"in_atelier"}')"
check "admin invalid transition -> 400" 400 "$(code -X PATCH $API/api/admin/orders/$ORDER_ID -H "authorization: Bearer $ADMIN_TOKEN" -H 'content-type: application/json' -d '{"status":"delivered"}')"

echo
echo "RESULT: $PASS passed, $FAIL failed"
[ "$FAIL" = "0" ]
