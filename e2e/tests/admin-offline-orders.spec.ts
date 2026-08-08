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

  await page.getByRole('radiogroup', { name: 'Channel' }).getByRole('radio', { name: 'In Store' }).click();
  await page.getByRole('radiogroup', { name: 'Bill type' }).getByRole('radio', { name: 'Cash Memo' }).click();

  // One freeform line; stated bill total wins; half paid in cash as advance.
  await page.locator('#oi-desc-0').fill('Sage lehenga with hand-embroidered dupatta');
  await page.locator('#oi-qty-0').fill('1');
  await page.locator('#oi-unit-0').fill('45000');
  await page.locator('#oi-total').fill('45000');
  await page.locator('#oi-advance').fill('20000');
  await page.getByRole('radiogroup', { name: 'Advance mode' }).getByRole('radio', { name: 'Cash' }).click();
  await page.getByRole('group', { name: 'Quick due date' }).getByRole('button', { name: '+14 days' }).click();

  await page.getByRole('button', { name: 'Record Order' }).click();
  await expect(page).toHaveURL(/\/orders/);

  // The new order is in the book — open its page (table row on desktop, card on phones).
  const entry = page
    .locator('tr.rowlink, .lcard')
    .filter({ hasText: 'Meera Shah' })
    .filter({ hasText: 'In the Atelier' })
    .first();
  await entry.click();
  await expect(page.getByRole('heading', { name: /TA-2026-\d+/ })).toBeVisible();
  await expect(page.getByText('Cash Memo')).toBeVisible();
  await expect(page.getByText('₹25,000').first()).toBeVisible(); // balance = 45,000 − 20,000

  // Record the remaining ₹25,000 in cash → balance clears and the pay form retires.
  await page.getByLabel('Amount (₹)').fill('25000');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(page.getByRole('button', { name: 'Record payment' })).toBeHidden();

  // Advance one step with the one-tap button — the PATCH flushes after the Undo window.
  const patched = page.waitForResponse(
    (r) => r.url().includes('/api/admin/orders/') && r.request().method() === 'PATCH',
  );
  await page.getByRole('button', { name: 'Move to Quality Check' }).click();
  await expect(page.getByText('Quality Check').first()).toBeVisible();
  await patched;
});
