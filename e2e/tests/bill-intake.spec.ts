import { test, expect, type APIRequestContext } from '@playwright/test';
import { ADMIN_URL, API, ORDER_NUMBER_RE, adminLogin, adminToken } from './helpers';

/** Unique 10-digit Indian mobile per run so customer upserts never collide. */
function uniquePhone(): string {
  return `9${String(Date.now()).slice(-9)}`;
}

/** Tiny valid 1×1 PNG — enough for createImageBitmap + the local upload transport. */
const TINY_PNG = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64',
);

/**
 * Probe the presign endpoint; when uploads are unavailable (route missing or
 * erroring — e.g. an older backend) the specs skip rather than fail.
 */
async function uploadsConfigured(request: APIRequestContext): Promise<boolean> {
  try {
    const token = await adminToken(request);
    const probe = await request.post(`${API}/api/admin/uploads/presign`, {
      headers: { Authorization: `Bearer ${token}` },
      data: { kind: 'bill', contentType: 'image/jpeg' },
    });
    return probe.status() === 201;
  } catch {
    return false;
  }
}

test('bill intake: photo upload → parse falls back (503) → manual review → order recorded @mobile', async ({
  page,
  request,
}) => {
  test.skip(!(await uploadsConfigured(request)), 'document uploads unavailable (presign failed)');

  await adminLogin(page);
  await page.goto(`${ADMIN_URL}/intake`);
  await expect(page.getByRole('heading', { name: 'Scan Bill' })).toBeVisible();

  // Capture — a generated PNG through the hidden camera input.
  await page.getByLabel('Bill photo file').setInputFiles({
    name: 'bill.png',
    mimeType: 'image/png',
    buffer: TINY_PNG,
  });
  await expect(page.getByAltText('Bill photo')).toBeVisible(); // upload finished → thumbnail
  await expect(page.getByRole('button', { name: 'Retake bill photo' })).toBeVisible();

  // Parse: with ANTHROPIC_API_KEY unset locally the parse 503s and the wizard
  // continues to a blank review with the photo still attached. (If parsing IS
  // configured the review arrives prefilled — the .fill() calls below replace
  // whatever is there, so the spec passes either way.)
  await page.getByRole('button', { name: 'Parse' }).click();
  await expect(page.getByRole('button', { name: 'Record Order' })).toBeVisible();

  // Review — complete the bill manually.
  const phone = uniquePhone();
  await page.locator('#oi-phone').fill(phone);
  await page.locator('#oi-first').fill('Scan');
  await page.locator('#oi-last').fill('Fallback');
  await page.getByRole('group', { name: 'Bill type' }).getByRole('button', { name: 'Cash Memo' }).click();
  await page.locator('#oi-desc-0').fill('Hand-embroidered dupatta');
  await page.locator('#oi-qty-0').fill('1');
  await page.locator('#oi-unit-0').fill('12000');
  await page.locator('#oi-total').fill('12000');

  // The uploaded photo is reviewable from the sticky peek.
  await page.getByRole('button', { name: 'View photos (1)' }).click();
  await expect(page.locator('.peek-body img')).toBeVisible();

  await page.getByRole('button', { name: 'Record Order' }).click();

  // Done — order number + next actions.
  const orderHeading = page.getByRole('heading', { name: ORDER_NUMBER_RE });
  await expect(orderHeading).toBeVisible();
  const orderNumber = (await orderHeading.innerText()).trim();
  await expect(page.getByRole('button', { name: 'Scan next bill' })).toBeVisible();

  // The recorded order shows up in the order book.
  await page.getByRole('button', { name: 'View orders' }).click();
  await expect(page.getByRole('heading', { name: 'Orders' })).toBeVisible();
  const row = page.getByRole('row').filter({ hasText: orderNumber });
  await expect(row).toBeVisible();
  await expect(row).toContainText('Scan Fallback');
  await expect(row.getByText('Cash Memo')).toBeVisible();
});

test('bill intake: manual escape hatch skips photos entirely @mobile', async ({ page, request }) => {
  test.skip(!(await uploadsConfigured(request)), 'document uploads unavailable (presign failed)');

  await adminLogin(page);
  await page.goto(`${ADMIN_URL}/intake`);
  await expect(page.getByRole('heading', { name: 'Scan Bill' })).toBeVisible();

  await page.getByRole('button', { name: 'Enter manually instead' }).click();
  await expect(page.getByRole('button', { name: 'Record Order' })).toBeVisible();

  await page.locator('#oi-phone').fill(uniquePhone());
  await page.locator('#oi-first').fill('Manual');
  await page.locator('#oi-desc-0').fill('Celadon stole');
  await page.locator('#oi-unit-0').fill('8000');
  await page.locator('#oi-total').fill('8000');
  await page.getByRole('button', { name: 'Record Order' }).click();

  await expect(page.getByRole('heading', { name: ORDER_NUMBER_RE })).toBeVisible();
});
