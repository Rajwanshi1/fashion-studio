import { test, expect } from '@playwright/test';
import { ADMIN_URL, adminLogin, cartDrawer, selectFirstAvailableSize } from './helpers';

// Untouched by the other specs (storefront.spec.ts / admin.spec.ts visit the
// Court Lehenga / Trail Kaftan / Threadwork Anarkali / Column Kaftan), so its
// analytics row is unambiguously produced by this test's own journey — even
// though the suite shares one backend and other specs emit their own events
// into the same 30-day window.
const IVY_JACKET = 'Zardozi Vine Suit';

test('storefront journey emits analytics events that surface on the admin dashboard', async ({
  page,
}) => {
  // Register the flush listener before the journey starts: the 10s timer
  // arms on the very first tracked event (the page_view fired by this
  // goto), so listening late could race a flush that already fired.
  const trackFlush = page.waitForResponse(
    (r) => r.url().includes('/api/track') && r.status() === 204,
    { timeout: 30_000 },
  );

  // Home -> collection -> PDP -> select size -> add to bag.
  await page.goto('/');
  await page.getByRole('link', { name: /Suits Explore/ }).click();
  await expect(page).toHaveURL(/\/collection\/suits/);
  await expect(page.getByRole('heading', { name: 'Suits', level: 1 })).toBeVisible();

  await page.getByRole('link', { name: new RegExp(IVY_JACKET) }).click();
  await expect(page.getByRole('heading', { name: IVY_JACKET, level: 1 })).toBeVisible();

  const size = await selectFirstAvailableSize(page);
  await page.getByRole('button', { name: 'Add to Bag' }).click();
  await expect(cartDrawer(page)).toContainText(IVY_JACKET);
  await expect(cartDrawer(page)).toContainText(`Size ${size}`);

  // The batched beacon (session_start/page_view/product_view/variant_select/
  // add_to_cart) flushes on its 10s timer, well inside the 60s test timeout.
  await trackFlush;

  // Admin: Sessions KPI >= 1 and the visited product's name in Top products.
  // Eventual consistency: the analytics page fetches once on mount, so poll
  // by reloading rather than asserting a single snapshot.
  await adminLogin(page);

  await expect(async () => {
    await page.goto(`${ADMIN_URL}/analytics`);

    const sessionsStat = page.locator('.stat').filter({ hasText: 'Sessions' });
    await expect(sessionsStat.locator('.v')).toBeVisible();
    const sessions = Number((await sessionsStat.locator('.v').innerText()).replace(/,/g, ''));
    expect(sessions).toBeGreaterThanOrEqual(1);

    // Only the top-products table has a "Views" column — scope to it so the
    // other DataTable instances (searches/sources/devices/sizes/colors)
    // can't accidentally satisfy the product-name match.
    const topProducts = page.locator('table.data').filter({ has: page.locator('th', { hasText: 'Views' }) });
    await expect(topProducts.locator('tbody tr').filter({ hasText: IVY_JACKET })).toHaveCount(1);
  }).toPass({ timeout: 30_000, intervals: [1_000, 2_000, 5_000] });
});
