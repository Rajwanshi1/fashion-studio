import { test, expect } from '@playwright/test';
import { ADMIN_URL, API, adminLogin, adminToken } from './helpers';

/** Unique 10-digit Indian mobile per run so customer upserts never collide. */
function uniquePhone(): string {
  return `9${String(Date.now()).slice(-9)}`;
}

test('offline order: intake → appears in Orders → record payment → advance status @mobile', async ({
  page,
  request,
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
  // Intake deep-links back as /orders?focus=<id>, and that order auto-expands.
  await expect(page).toHaveURL(/\/orders\?focus=/);
  const focusId = new URL(page.url()).searchParams.get('focus')!;

  // Resolve this run's order number — a reused database keeps identical
  // "Meera Shah" rows from earlier runs, so the name cannot identify the row.
  const token = await adminToken(request);
  const listRes = await request.get(`${API}/api/admin/orders`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const created = ((await listRes.json()) as { id: string; orderNumber: string }[]).find(
    (o) => o.id === focusId,
  );
  if (!created) throw new Error(`created order ${focusId} not in the admin list`);

  const row = page.getByRole('row').filter({ hasText: created.orderNumber }).first();
  await expect(row).toBeVisible();
  await expect(row.getByText('Cash Memo')).toBeVisible();
  await expect(row).toContainText('25,000'); // balance = 45,000 − 20,000

  // Already expanded via the focus deep link — record the remaining ₹25,000.
  await page.locator(`#pay-${focusId}`).fill('25000');
  await page.getByRole('button', { name: 'Record payment' }).click();
  await expect(row).not.toContainText('25,000');

  // Advance the offline machine one step: In the Atelier → Quality Check.
  await page.locator(`#status-${focusId}`).selectOption({ label: 'Quality Check' });
  await expect(row.getByText('Quality Check')).toBeVisible();
});

test('offline order: a catalogue-linked line reserves stock, cancelling restores it', async ({
  page,
  request,
}) => {
  // A piece with stock the other specs leave alone.
  const token = await adminToken(request);
  const productsRes = await request.get(`${API}/api/admin/products`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const products = (await productsRes.json()) as {
    id: string;
    name: string;
    active: boolean;
    variants: { id: string; size: string; stock: number }[];
  }[];
  const piece = products.find(
    (p) => p.active && p.name !== 'Tissue Column Kaftan' && p.variants.some((v) => v.stock > 0),
  );
  if (!piece) throw new Error('no in-stock piece for the linked-line spec');
  const variant = piece.variants.find((v) => v.stock > 0)!;

  await adminLogin(page);
  await page.goto(`${ADMIN_URL}/orders/new`);
  await page.locator('#oi-phone').fill(uniquePhone());
  await page.locator('#oi-first').fill('Linked');
  await page.getByRole('group', { name: 'Bill type' }).getByRole('button', { name: 'Cash Memo' }).click();

  // Pick the piece + size from the catalogue instead of typing a freeform line.
  await page.locator('#oi-picker').fill(piece.name.slice(0, 8));
  await page.getByRole('button', { name: new RegExp(piece.name) }).first().click();
  await page
    .getByRole('group', { name: `Sizes for ${piece.name}` })
    .getByRole('button', { name: new RegExp(`^${variant.size} ·`) })
    .click();
  await expect(page.getByText('Linked · reserves stock')).toBeVisible();

  await page.getByRole('button', { name: 'Record Order' }).click();
  await expect(page).toHaveURL(/\/orders\?focus=/);
  const focusId = new URL(page.url()).searchParams.get('focus')!;

  // Stock went down by one.
  const after = (await (
    await request.get(`${API}/api/admin/products`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { id: string; variants: { id: string; stock: number }[] }[];
  const afterVariant = after.find((p) => p.id === piece.id)!.variants.find((v) => v.id === variant.id)!;
  expect(afterVariant.stock).toBe(variant.stock - 1);

  // Cancel through the guarded dropdown — the modal confirms, stock returns.
  await page.locator(`#status-${focusId}`).selectOption({ label: 'Cancelled' });
  await page.getByRole('dialog').getByRole('button', { name: 'Cancel order' }).click();
  await expect(page.getByText('no further transitions').first()).toBeVisible();

  const restored = (await (
    await request.get(`${API}/api/admin/products`, { headers: { Authorization: `Bearer ${token}` } })
  ).json()) as { id: string; variants: { id: string; stock: number }[] }[];
  const restoredVariant = restored
    .find((p) => p.id === piece.id)!
    .variants.find((v) => v.id === variant.id)!;
  expect(restoredVariant.stock).toBe(variant.stock);
});
