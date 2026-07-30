import { test, expect } from '@playwright/test';
import { ADMIN_URL, adminLogin } from './helpers';

/** Unique 10-digit Indian mobile per run so customer upserts never collide. */
function uniquePhone(): string {
  return `9${String(Date.now()).slice(-9)}`;
}

test('offline order: intake → appears in Orders → record payment → advance status @mobile', async ({
  page,
}) => {
  await adminLogin(page);
  await page.goto(`${ADMIN_URL}/orders/new`);
  await expect(page.getByRole('heading', { name: 'New Order' })).toBeVisible();

  // Customer — a fresh phone, so this is a create (no match card).
  const phone = uniquePhone();
  await page.locator('#oi-phone').fill(phone);
  await page.locator('#oi-first').fill('Meera');
  await page.locator('#oi-last').fill('Shah');

  await page.getByRole('group', { name: 'Order channel' }).getByRole('button', { name: 'In Store' }).click();
  await page.getByRole('group', { name: 'Bill type' }).getByRole('button', { name: 'Cash Memo' }).click();

  // One freeform line; stated bill total wins; half paid in cash as advance.
  await page.locator('#oi-desc-0').fill('Sage lehenga with hand-embroidered dupatta');
  await page.locator('#oi-qty-0').fill('1');
  await page.locator('#oi-unit-0').fill('45000');
  await page.locator('#oi-total').fill('45000');
  await page.locator('#oi-advance').fill('20000');
  await page.getByRole('group', { name: 'Advance mode' }).getByRole('button', { name: 'Cash' }).click();
  await page.getByRole('group', { name: 'Quick due date' }).getByRole('button', { name: '+14 days' }).click();

  await page.getByRole('button', { name: 'Record Order' }).click();
  await expect(page).toHaveURL(/\/orders/);

  // The new order shows up in production with its cash-memo badge and open balance.
  const row = page
    .getByRole('row')
    .filter({ hasText: 'Meera Shah' })
    .filter({ hasText: 'In the Atelier' })
    .first();
  await expect(row).toBeVisible();
  await expect(row.getByText('Cash Memo')).toBeVisible();
  await expect(row).toContainText('25,000'); // balance = 45,000 − 20,000

  // Expand → record the remaining ₹25,000 in cash → balance clears.
  await row.click();
  await page.locator('input[id^="pay-"]').first().fill('25000');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(row).not.toContainText('25,000');

  // Advance the offline machine one step: In the Atelier → Quality Check.
  await page.locator('select[id^="status-"]').first().selectOption({ label: 'Quality Check' });
  await expect(row.getByText('Quality Check')).toBeVisible();
});
