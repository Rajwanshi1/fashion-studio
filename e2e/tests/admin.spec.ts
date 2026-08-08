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

  // The row opens the order's own page; status advances with the one-tap button.
  await row.click();
  await expect(page.getByRole('heading', { name: order.orderNumber })).toBeVisible();
  // The commit is deferred behind a 5s Undo window — wait for the PATCH to flush.
  const patched = page.waitForResponse(
    (r) => r.url().includes('/api/admin/orders/') && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Move to In the Atelier' }).click();
  await expect(page.getByText('In the Atelier').first()).toBeVisible(); // optimistic UI
  await patched;
  await page.goto(`${ADMIN_URL}/orders`);
  const updated = page.getByRole('row').filter({ hasText: order.orderNumber });
  await expect(updated.getByText('In the Atelier')).toBeVisible();
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
