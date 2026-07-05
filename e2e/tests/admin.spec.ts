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

const FERN_GOWN = 'Fern Pleated Tissue Gown';

// A paid order created through the public API before the admin tests run,
// so every assertion below is against data this run created.
let order: CreatedOrder;

test.beforeAll(async ({ playwright }) => {
  const ctx = await playwright.request.newContext();
  order = await createPaidOrderViaApi(ctx, uniqueEmail('adminspec'), 'celadon-organza-cape-set');
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

test('products: 16+ pieces listed; S-size stock edit persists and is restored', async ({
  page,
  request,
}) => {
  await adminLogin(page);
  await page.goto(`${ADMIN_URL}/products`);
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();

  // 16 seeded pieces (at least) — the 16th body row must exist.
  const bodyRows = page.locator('table.data tbody tr');
  await expect(bodyRows.nth(15)).toBeVisible();

  // Open one piece and bump its S-size stock.
  await page.getByRole('cell', { name: FERN_GOWN }).click();
  await expect(page.getByRole('heading', { name: 'Edit Piece' })).toBeVisible();
  const editUrl = page.url();
  const sStock = page.getByLabel('S', { exact: true });
  const original = await sStock.inputValue();
  const bumped = String(Number(original) + 7);
  await sStock.fill(bumped);
  await page.getByRole('button', { name: 'Save Piece' }).click();
  await expect(page.getByRole('heading', { name: 'Products' })).toBeVisible();

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
