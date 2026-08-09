import { test, expect } from '@playwright/test';
import {
  ADMIN_URL,
  adminLogin,
  adminProducts,
  adminToken,
  createPaidOrderViaApi,
  restockVariantById,
  setVariantStock,
  uniqueEmail,
  type CreatedOrder,
} from './helpers';

const FERN_GOWN = 'Tissue Column Kaftan';
// Untouched by the other specs, so this run's order is unambiguously its own.
const ORDER_SLUG = 'heritage-silk-anarkali-verdigris';

// A paid order created through the public API before the admin tests run,
// so every assertion below is against data this run created.
let order: CreatedOrder;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  order = await createPaidOrderViaApi(ctx, uniqueEmail('adminspec'), ORDER_SLUG);
  await ctx.dispose();
});

test.afterAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  await restockVariantById(ctx, order.variantId, order.quantity);
  await ctx.dispose();
});

test('dashboard renders the stat cards', async ({ page }) => {
  await adminLogin(page);
  const activeOrders = page.locator('.stat').filter({ hasText: 'Active Orders' });
  await expect(activeOrders).toBeVisible();
  const revenue = page.locator('.stat').filter({ hasText: 'Revenue' });
  await expect(revenue).toBeVisible();
  await expect(revenue).toContainText('₹');
  await expect(page.getByText('Recent orders')).toBeVisible();
});

test('orders: the paid order appears and can advance to In the Atelier', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`${ADMIN_URL}/orders`);
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: order.orderNumber });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Paid', { exact: true })).toBeVisible();

  // Expand the row and use the constrained status select.
  await row.click();
  // exact: true — the status-filter chip group is also labelled "Filter by status".
  await page.getByLabel('Status', { exact: true }).selectOption({ label: 'In the Atelier' });
  await expect(row.getByText('In the Atelier')).toBeVisible();
});

test('payments: the captured payment for the order is listed', async ({ page }) => {
  await adminLogin(page);
  await page.goto(`${ADMIN_URL}/payments`);
  await expect(page.getByRole('heading', { name: 'Payments' })).toBeVisible();

  const row = page.getByRole('row').filter({ hasText: order.orderNumber });
  await expect(row).toHaveCount(1);
  await expect(row.getByText('Captured')).toBeVisible();
  await expect(row).toContainText('₹');
});

test('products: 13+ pieces listed; S-size stock edit persists and is restored', async ({
  page,
  request,
}) => {
  await adminLogin(page);
  await page.goto(`${ADMIN_URL}/products`);
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();

  // 13 seeded pieces (at least) — the 13th body row must exist.
  const bodyRows = page.locator('table.data tbody tr');
  await expect(bodyRows.nth(12)).toBeVisible();

  // Open one piece and bump its S-size stock. `exact` matters: the row's
  // bulk-select checkbox is labelled "Select <name>", so a loose name match
  // resolves to both cells.
  await page.getByRole('cell', { name: FERN_GOWN, exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Edit Piece' })).toBeVisible();
  const editUrl = page.url();
  const sStock = page.getByLabel('S', { exact: true });
  const original = await sStock.inputValue();
  const bumped = String(Number(original) + 7);
  await sStock.fill(bumped);
  await page.getByRole('button', { name: 'Save Piece' }).click();
  // Save posts to the API then routes back to the list; allow for staging
  // save round-trip + navigation latency over CloudFront (default 10s flakes cold).
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible({ timeout: 30_000 });

  // Reload the edit page — the new value must have persisted.
  await page.goto(editUrl);
  await expect(page.getByLabel('S', { exact: true })).toHaveValue(bumped);

  // Restore the original value via the admin API, then verify in the UI.
  const token = await adminToken(request);
  const product = (await adminProducts(request, token)).find((p) => p.name === FERN_GOWN);
  if (!product) throw new Error(`product not found: ${FERN_GOWN}`);
  const variant = product.variants.find((v) => v.size === 'S');
  if (!variant) throw new Error(`S variant not found for ${FERN_GOWN}`);
  await setVariantStock(request, token, variant.id, Number(original));
  await page.goto(editUrl);
  await expect(page.getByLabel('S', { exact: true })).toHaveValue(original);
});

test('products: bulk sale discounts a piece from its own price, then ends the sale', async ({
  page,
  request,
}) => {
  const token = await adminToken(request);
  // A piece no other spec touches. Unflagged on purpose: ending a sale clears
  // the flag outright, so only an unflagged piece is left exactly as found.
  const piece = (await adminProducts(request, token)).find(
    (p) => p.name !== FERN_GOWN && p.slug !== ORDER_SLUG && p.flag === null && p.active,
  );
  if (!piece) throw new Error('no eligible unflagged piece to put on sale');
  const expectedSale = Math.round((piece.price * 80) / 10000) * 100;

  // Every bulk action confirms first.
  page.on('dialog', (dialog) => void dialog.accept());

  await adminLogin(page);
  await page.goto(`${ADMIN_URL}/products`);
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();

  const row = page.locator('table.data tbody tr').filter({ hasText: piece.name }).first();
  await row.getByRole('checkbox', { name: `Select ${piece.name}` }).check();
  await page.getByLabel('Discount %').fill('20');
  await page.getByRole('button', { name: 'Put on sale' }).click();

  // The page reloads from the API, so this asserts what was actually saved.
  await expect(row).toContainText('−20%');
  const sold = (await adminProducts(request, token)).find((p) => p.id === piece.id);
  expect(sold?.flag).toBe('sale');
  expect(sold?.salePrice).toBe(expectedSale);
  // The list price survives, which is what makes the discount reversible.
  expect(sold?.price).toBe(piece.price);

  await row.getByRole('checkbox', { name: `Select ${piece.name}` }).check();
  await page.getByRole('button', { name: 'End sale' }).click();
  await expect(row).not.toContainText('−20%');

  const restored = (await adminProducts(request, token)).find((p) => p.id === piece.id);
  expect(restored?.salePrice).toBeNull();
  expect(restored?.price).toBe(piece.price);
});
