import { test, expect, type APIRequestContext } from '@playwright/test';
import { API } from './helpers';

// The backend must run with SMS_PROVIDER=console and OTP_DEV_CODE for these
// specs; when OTP is masked (503) they skip rather than fail.
const DEV_CODE = process.env.E2E_OTP_CODE ?? '123456';

/** Unique 10-digit Indian mobile per run so user upserts never collide. */
function uniquePhone(): string {
  return `9${String(Date.now()).slice(-9)}`;
}

async function otpConfigured(request: APIRequestContext): Promise<boolean> {
  const probe = await request.post(`${API}/api/auth/otp/request`, {
    data: { phone: uniquePhone() },
  });
  return probe.status() !== 503;
}

test('phone OTP login: send code → verify → signed-in account @mobile', async ({ page, request }) => {
  test.skip(!(await otpConfigured(request)), 'phone OTP masked (SMS_PROVIDER unset)');

  const phone = uniquePhone();
  await page.goto('/login');
  await page.getByRole('button', { name: 'Phone' }).click();
  await page.getByLabel('Mobile Number').fill(phone);
  await page.getByRole('button', { name: 'Send Code' }).click();

  await expect(page.getByLabel('One-Time Code')).toBeVisible();
  await page.getByLabel('One-Time Code').fill(DEV_CODE);
  await page.getByRole('button', { name: 'Verify & Sign In' }).click();

  // Lands on the account page as a phone-only customer.
  await expect(page).toHaveURL(/\/account/);
  await expect(page.getByText('Signed in as')).toBeVisible();
  await expect(page.getByText(`+91${phone}`)).toBeVisible();
});

test('phone OTP login: a wrong code shows an error and stays on the login page', async ({ page, request }) => {
  test.skip(!(await otpConfigured(request)), 'phone OTP masked (SMS_PROVIDER unset)');

  const wrong = DEV_CODE === '000000' ? '111111' : '000000';
  await page.goto('/login');
  await page.getByRole('button', { name: 'Phone' }).click();
  await page.getByLabel('Mobile Number').fill(uniquePhone());
  await page.getByRole('button', { name: 'Send Code' }).click();
  await page.getByLabel('One-Time Code').fill(wrong);
  await page.getByRole('button', { name: 'Verify & Sign In' }).click();

  await expect(page.getByText(/Code incorrect or expired/)).toBeVisible();
  await expect(page).toHaveURL(/\/login/);
});
