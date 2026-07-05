import { expect, type APIRequestContext, type Locator, type Page } from '@playwright/test';

export const API = 'http://localhost:3001';
export const ADMIN_URL = 'http://localhost:4174';
export const ADMIN_EMAIL = 'admin@tanviagnihotry.com';
export const ADMIN_PASSWORD = 'TanviAdmin@2026';

/** Boutique order numbers, e.g. TA-2026-04815. */
export const ORDER_NUMBER_RE = /TA-2026-\d+/;

/** Unique per-run email so every spec asserts only on data it created. */
export function uniqueEmail(tag: string): string {
  return `${tag}-${Date.now()}-${Math.floor(Math.random() * 10_000)}@example.com`;
}

// ---------------------------------------------------------------------------
// Backend API helpers (admin token, stock restore, order factory)
// ---------------------------------------------------------------------------

export interface AdminVariant {
  id: string;
  size: string;
  stock: number;
}

export interface AdminProductRow {
  id: string;
  name: string;
  slug: string;
  variants: AdminVariant[];
}

export async function adminToken(request: APIRequestContext): Promise<string> {
  const res = await request.post(`${API}/api/auth/login`, {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  });
  expect(res.ok(), 'admin login should succeed').toBeTruthy();
  return ((await res.json()) as { token: string }).token;
}

export async function adminProducts(
  request: APIRequestContext,
  token: string,
): Promise<AdminProductRow[]> {
  const res = await request.get(`${API}/api/admin/products`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  expect(res.ok(), 'admin products list should load').toBeTruthy();
  return (await res.json()) as AdminProductRow[];
}

export async function setVariantStock(
  request: APIRequestContext,
  token: string,
  variantId: string,
  stock: number,
): Promise<void> {
  const res = await request.patch(`${API}/api/admin/variants/${variantId}`, {
    headers: { Authorization: `Bearer ${token}` },
    data: { stock },
  });
  expect(res.ok(), `variant ${variantId} stock update should succeed`).toBeTruthy();
}

/** Restore stock consumed by an API-created order: +qty on a known variant id. */
export async function restockVariantById(
  request: APIRequestContext,
  variantId: string,
  qty = 1,
): Promise<void> {
  const token = await adminToken(request);
  for (const product of await adminProducts(request, token)) {
    const variant = product.variants.find((v) => v.id === variantId);
    if (variant) {
      await setVariantStock(request, token, variant.id, variant.stock + qty);
      return;
    }
  }
  throw new Error(`restock: variant not found: ${variantId}`);
}

/** Restore stock consumed by a UI-created order: +qty on (productName, size). */
export async function restockAfterOrder(
  request: APIRequestContext,
  productName: string,
  size: string,
  qty = 1,
): Promise<void> {
  const token = await adminToken(request);
  const product = (await adminProducts(request, token)).find((p) => p.name === productName);
  if (!product) throw new Error(`restock: product not found: ${productName}`);
  const variant = product.variants.find((v) => v.size === size);
  if (!variant) throw new Error(`restock: variant not found: ${productName} / ${size}`);
  await setVariantStock(request, token, variant.id, variant.stock + qty);
}

export interface CreatedOrder {
  id: string;
  orderNumber: string;
  total: number;
  variantId: string;
  quantity: number;
}

/** Create a fully paid order straight through the public API (order → checkout → confirm). */
export async function createPaidOrderViaApi(
  request: APIRequestContext,
  email: string,
  productSlug: string,
): Promise<CreatedOrder> {
  const prodRes = await request.get(`${API}/api/products/${productSlug}`);
  expect(prodRes.ok(), `product ${productSlug} should load`).toBeTruthy();
  const raw = (await prodRes.json()) as {
    product?: { variants: AdminVariant[] };
    variants?: AdminVariant[];
  };
  const detail = raw.product ?? (raw as { variants: AdminVariant[] });
  const variant = detail.variants.find((v) => v.stock > 0);
  if (!variant) throw new Error(`no in-stock variant for ${productSlug}`);

  const orderRes = await request.post(`${API}/api/orders`, {
    data: {
      customer: {
        email,
        phone: '+91 98200 44556',
        firstName: 'Zoya',
        lastName: 'Apiwala',
        addressLine1: '7 Marine Drive',
        addressLine2: '',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400026',
        country: 'India',
      },
      deliveryMethod: 'standard',
      items: [{ variantId: variant.id, quantity: 1 }],
    },
  });
  expect(orderRes.ok(), 'order creation should succeed').toBeTruthy();
  const order = (await orderRes.json()) as { id: string; orderNumber: string; total: number };

  const payRes = await request.post(`${API}/api/payments/checkout`, {
    data: { orderId: order.id },
  });
  expect(payRes.ok(), 'payment checkout should succeed').toBeTruthy();
  const payment = (await payRes.json()) as { paymentId: string };

  const confirmRes = await request.post(`${API}/api/payments/confirm`, {
    data: { paymentId: payment.paymentId, outcome: 'success' },
  });
  expect(confirmRes.ok(), 'payment confirm should succeed').toBeTruthy();

  return {
    id: order.id,
    orderNumber: order.orderNumber,
    total: order.total,
    variantId: variant.id,
    quantity: 1,
  };
}

// ---------------------------------------------------------------------------
// Storefront UI helpers
// ---------------------------------------------------------------------------

/** The slide-in bag drawer (located via its aria-label; it has no heading role). */
export function cartDrawer(page: Page): Locator {
  return page.locator('aside[aria-label="Shopping bag"]');
}

/**
 * On a PDP, click the first in-stock size button and return its label.
 * Workaround selector: the size buttons carry no accessible group name,
 * so we scope by the #sizes container and skip the "Made to Measure" CTA.
 */
export async function selectFirstAvailableSize(page: Page): Promise<string> {
  const btn = page.locator('#sizes button.size:not(.custom):enabled').first();
  await expect(btn).toBeVisible();
  const size = (await btn.innerText()).trim();
  await btn.click();
  return size;
}

export interface GuestDetails {
  email: string;
  firstName?: string;
  lastName?: string;
}

/** Fill the checkout contact + shipping form (Mumbai / Maharashtra / 400026). */
export async function fillCheckoutDetails(page: Page, details: GuestDetails): Promise<void> {
  await page.getByLabel('Email Address').fill(details.email);
  await page.getByLabel('Mobile Number').fill('+91 98200 11223');
  await page.getByLabel('First Name').fill(details.firstName ?? 'Aanya');
  await page.getByLabel('Last Name').fill(details.lastName ?? 'Verma');
  await page.getByLabel('Address', { exact: true }).fill('12 Altamount Road');
  await page.getByLabel('City').fill('Mumbai');
  await page.getByLabel('PIN Code').fill('400026');
  await page.getByLabel('State').selectOption('Maharashtra');
  await page.getByLabel('Country').selectOption('India');
}

export function razorpayModal(page: Page): Locator {
  return page.getByRole('dialog', { name: 'Razorpay · Test Mode' });
}

/** Pay in the masked Razorpay modal and wait for the confirmation page. */
export async function payAndConfirm(page: Page): Promise<string> {
  const modal = razorpayModal(page);
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: /^Pay ₹/ }).click();
  await expect(page).toHaveURL(/\/order\/TA-2026-\d+/);
  const match = /\/order\/(TA-2026-\d+)/.exec(page.url());
  if (!match) throw new Error(`no order number in url: ${page.url()}`);
  return match[1];
}

// ---------------------------------------------------------------------------
// Admin UI helpers
// ---------------------------------------------------------------------------

export async function adminLogin(page: Page): Promise<void> {
  await page.goto(`${ADMIN_URL}/login`);
  await page.getByLabel('Email').fill(ADMIN_EMAIL);
  await page.getByLabel('Password').fill(ADMIN_PASSWORD);
  await page.getByRole('button', { name: 'Sign In' }).click();
  await expect(page.getByRole('heading', { name: 'Dashboard' })).toBeVisible();
}
