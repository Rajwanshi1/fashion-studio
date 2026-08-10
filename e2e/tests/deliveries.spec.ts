import { test, expect } from '@playwright/test';
import { ADMIN_URL, API, adminLogin, adminToken } from './helpers';

/** Unique 10-digit Indian mobile per run so customer upserts never collide. */
function uniquePhone(): string {
  return `9${String(Date.now()).slice(-9)}`;
}

function plusDays(n: number): string {
  // IST, matching the board's todayIST() — a UTC date here is yesterday's
  // date in the boutique until 05:30 IST and flips the bucket assertions.
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Kolkata' }).format(
    new Date(Date.now() + n * 86_400_000),
  );
}

test('deliveries board: an offline order lands in Next 7 days with its balance @mobile', async ({
  page,
  request,
}) => {
  const token = await adminToken(request);
  const res = await request.post(`${API}/api/admin/orders`, {
    headers: { Authorization: `Bearer ${token}` },
    data: {
      channel: 'in_store',
      billType: 'cash_memo',
      customer: { action: 'create', firstName: 'Board', lastName: 'Test', phone: uniquePhone() },
      items: [{ description: 'Test lehenga', quantity: 1, unitPrice: 4000000 }],
      total: 4000000,
      advance: { amount: 1500000, mode: 'cash' },
      deliveryDueDate: plusDays(5),
    },
  });
  expect(res.status()).toBe(201);
  const order = (await res.json()) as { orderNumber: string };

  await adminLogin(page);
  await page.goto(`${ADMIN_URL}/deliveries`);
  // exact: the KPI card label only — every order card also says "to collect".
  await expect(page.getByText('To collect', { exact: true })).toBeVisible();

  // Scope to this run's card by its order number — earlier runs leave
  // same-shaped cards behind on a reused database.
  const bucket = page.locator('details.dl-bucket').filter({ hasText: 'Next 7 days' });
  const card = bucket.locator('.dl-card').filter({ hasText: order.orderNumber });
  await expect(card).toBeVisible();
  await expect(card.getByText('₹25,000')).toBeVisible(); // 40,000 − 15,000 advance
});

test('customers.vcf export answers with vCards for phone customers', async ({ request }) => {
  const token = await adminToken(request);
  const res = await request.get(`${API}/api/admin/customers.vcf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.status()).toBe(200);
  expect(res.headers()['content-type']).toContain('text/vcard');
  expect(res.headers()['content-disposition']).toContain('ta-customers.vcf');
  expect(await res.text()).toContain('BEGIN:VCARD');
});
