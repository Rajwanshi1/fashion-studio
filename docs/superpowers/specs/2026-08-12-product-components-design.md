# Product components ("This order contains") — design

## Problem

Every product's set was described by exactly two hard-coded fields, `dupattaPrice`
and `jacketPrice` (paise; null = not in the set, 0 = included free). The PDP
rendered them as the "This piece includes" tickable add-ons; checkout priced
them server-side. But real pieces are sets of arbitrary components — kurti,
churidar, blouse, cape, potli bag — and the atelier needs to state what an
order contains, per product, with a required/optional toggle per piece.

## Decisions

- **One generalized list replaces the two fields.** A product carries an ordered
  `components` list; each row is `{ name, optional, price }`. Price is paise and
  only meaningful on optional rows (0 = included free, null = no separate
  price); the server normalizes price to null on required rows.
- **Optional priced rows keep today's add-on behaviour**: default included,
  shopper can untick, unticking reprices the line. Required/unpriced rows are
  informational lines on the PDP.
- **Checkout sends exclusions, not inclusions**: `excludedComponents: string[]`
  (names the shopper unticked), matched trim/case-insensitively against the
  product's optional components; unknown names are ignored. Default = all
  included — the same "opt-out" polarity the old booleans had.
- **Summaries carry `addonsTotal`** (SUM of optional priced components) instead
  of the two prices, so card prices (`price + addonsTotal`) and the SQL price
  sorts keep matching what shoppers see.
- **Order lines snapshot the kept add-ons** as `order_items.components` jsonb
  (`[{ name, price }]`) — denormalized like every other snapshot column, so
  history never re-joins product data.
- **Deprecate now, drop later**: the legacy columns stay physically in place
  (unread, unwritten) and are dropped in a later chore migration once prod has
  soaked. The old backend keeps working while 013 applies mid-deploy.

## Storage (migration 013)

```sql
CREATE TABLE product_components (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES products(id) ON DELETE CASCADE,
  name text NOT NULL,
  optional boolean NOT NULL DEFAULT false,
  price integer CHECK (price >= 0),
  position int NOT NULL DEFAULT 0
);
CREATE INDEX product_components_product_idx ON product_components (product_id, position);

INSERT INTO product_components (product_id, name, optional, price, position)
  SELECT id, 'Dupatta', true, dupatta_price, 0 FROM products WHERE dupatta_price IS NOT NULL;
INSERT INTO product_components (product_id, name, optional, price, position)
  SELECT id, 'Jacket', true, jacket_price, 1 FROM products WHERE jacket_price IS NOT NULL;

ALTER TABLE order_items ADD COLUMN components jsonb NOT NULL DEFAULT '[]';
UPDATE order_items SET components = /* dupatta_price/jacket_price → [{name,price}] */ ...
```

Old `order_items` rows backfill with lowercase names (`dupatta`, `jacket`) so
re-rendered historical invoices stay byte-identical ("— with dupatta & jacket").

## API

- `ProductSummary`: −`dupattaPrice` −`jacketPrice` +`addonsTotal: number`.
- `ProductDetail`: +`components: ProductComponent[]` (ordered).
- `OrderItem`: −the two prices +`components: { name, price }[]`.
- Admin POST/PUT `/admin/products`: `components` array (≤10 rows, names ≤40
  chars — WAF body-budget caps), absent = untouched / present = wholesale
  replace, exactly like `images`.
- `POST /orders` items: +`excludedComponents` (≤10 × ≤40 chars). The old
  `includeDupatta`/`includeJacket` booleans are still accepted for one release
  (mapped to exclusions in the route) so a cached old SPA can't overcharge a
  shopper mid-deploy; remove with the column-drop chore.

## Admin UX

"Set includes" (two price inputs) becomes a "This order contains" repeatable-row
editor (name · Optional toggle · price-when-optional · reorder/remove · add,
max 10), reusing the `.row-list` row idiom. Rupees in the form, paise on the
wire, validated in the existing collect-all-problems pass.

## Storefront

The PDP section renders every component as a numbered line; optional priced rows
are the familiar tickable checkboxes (0 = "Included"). The cart line stores
`includedComponents` (display) + `excludedComponents` (API + line identity);
old localStorage carts are normalized on load like the two previous shape
migrations. Card/list prices use `price + addonsTotal`.

## Testing

- Backend: fakes mirror the repo semantics (`addonsTotal`, wholesale replace,
  price-dropped-on-required-rows); service tests cover default-include,
  exclusion repricing, case-insensitive matching, unknown-name no-ops, combo
  merging; API tests cover the components round-trip and the legacy-boolean
  shim end-to-end.
- SQL verified against a throwaway Postgres (fakes run no SQL): 013 backfill
  counts, order_items backfill on a legacy row, `addons_total` in summaries and
  price sorts, wholesale replace, checkout pricing through the API.
- Storefront/admin RTL suites updated for the new shapes, plus a cart
  localStorage migration test.

## Out of scope

- Dropping the legacy columns (follow-up migration after prod soak).
- Snapshotting required components onto order lines (packing-list use case) —
  kept-optional-only preserves today's semantics.
- Per-component images or stock.
