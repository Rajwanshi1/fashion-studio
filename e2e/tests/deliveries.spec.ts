import { test, expect } from '@playwright/test';
import { ADMIN_URL, API, adminLogin, adminToken } from './helpers';

/** Unique 10-digit Indian mobile per run so customer upserts never collide. */
function uniquePhone(): string {
  return `9${String(Date.now()).slice(-9)}`;
}

function plusDays(n: number): string {
  return new Date(Date.now() + n * 86_400_000).toISOString().slice(0, 10);
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
  await expect(page.getByText('To collect')).toBeVisible();

  const bucket = page.locator('details.dl-bucket').filter({ hasText: 'Next 7 days' });
  await expect(bucket.getByText(order.orderNumber)).toBeVisible();
  await expect(bucket.getByText('₹25,000')).toBeVisible(); // 40,000 − 15,000 advance
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
