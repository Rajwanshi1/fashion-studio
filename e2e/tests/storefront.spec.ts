import { test, expect } from '@playwright/test';
import {
  cartDrawer,
  ORDER_NUMBER_RE,
  fillCheckoutDetails,
  payAndConfirm,
  razorpayModal,
  restockAfterOrder,
  selectFirstAvailableSize,
  uniqueEmail,
} from './helpers';

const SAGE_LEHENGA = 'Zardozi Court Lehenga';
const MOSS_GOWN = 'Organza Trail Kaftan';
const PISTACHIO_ANARKALI = 'Threadwork Anarkali';
const FERN_GOWN = 'Tissue Column Kaftan';

// ---------------------------------------------------------------------------
// Spec 1 — full guest purchase journey (runs on desktop AND mobile: @mobile)
// ---------------------------------------------------------------------------

test('guest purchase journey: home → collection → PDP → bag → checkout → paid @mobile', async ({
  page,
  isMobile,
  request,
}) => {
  // Home renders hero copy, categories and priced bestsellers.
  await page.goto('/');
  await expect(page.getByRole('heading', { level: 1 })).toContainText('Tanvi Agnihotry');
  await expect(page.getByRole('heading', { name: 'Shop by category' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Bestsellers' })).toBeVisible();
  // Bestseller cards are API-fed; poll until a ₹ price shows up.
  await expect(page.locator('#best .price').first()).toContainText('₹');

  // Navigate to the Lehenga collection.
  if (isMobile) {
    await page.getByRole('button', { name: 'Open menu' }).click();
    await page.getByRole('link', { name: 'Women' }).click();
  } else {
    await page.getByRole('link', { name: /Lehenga Explore/ }).click();
  }
  await expect(page).toHaveURL(/\/collection\/lehenga/);
  await expect(page.getByRole('heading', { name: 'Lehenga', level: 1 })).toBeVisible();

  // Open a product detail page.
  await page.getByRole('link', { name: new RegExp(SAGE_LEHENGA) }).click();
  await expect(page.getByRole('heading', { name: SAGE_LEHENGA, level: 1 })).toBeVisible();
  await expect(page.locator('.pdp .info .price')).toContainText('₹');
  await expect(page.getByText('incl. of all taxes')).toBeVisible();

  // Select a size and add to bag.
  const size = await selectFirstAvailableSize(page);
  await page.getByRole('button', { name: 'Add to Bag' }).click();

  // Cart drawer opens with the item.
  const drawer = cartDrawer(page);
  await expect(drawer).toContainText(SAGE_LEHENGA);
  await expect(drawer).toContainText(`Size ${size}`);
  await expect(drawer.locator('.cd-subval')).toContainText('₹');
  await drawer.getByRole('link', { name: 'View Full Bag' }).click();

  // Cart page shows the line and matching totals.
  await expect(page).toHaveURL(/\/cart/);
  await expect(page.getByRole('heading', { name: 'Your Bag', level: 1 })).toBeVisible();
  const line = page.locator('article.line');
  await expect(line).toHaveCount(1);
  await expect(line).toContainText(SAGE_LEHENGA);
  const lineTotal = (await line.locator('.price-col').innerText()).trim();
  expect(lineTotal).toMatch(/^₹/);
  await expect(page.locator('aside.summary .stotal .v')).toHaveText(lineTotal);

  // Guest checkout: contact + address, standard delivery, place order.
  await page.getByRole('button', { name: 'Proceed to Checkout' }).click();
  await expect(page).toHaveURL(/\/checkout/);
  const email = uniqueEmail(isMobile ? 'guest-mobile' : 'guest-desktop');
  await fillCheckoutDetails(page, { email });
  await page.getByText('Made-to-Order Atelier Dispatch').click(); // standard delivery
  await page.getByRole('button', { name: /Place Order/ }).click();

  // Masked Razorpay modal → Pay → confirmation.
  await expect(razorpayModal(page)).toContainText('Test mode');
  const orderNumber = await payAndConfirm(page);
  expect(orderNumber).toMatch(ORDER_NUMBER_RE);
  await expect(page.getByRole('heading', { name: /Thank you/ })).toBeVisible();
  await expect(page.getByText(ORDER_NUMBER_RE)).toBeVisible();
  await expect(page.getByText(email, { exact: false })).toBeVisible();

  // Bag count resets after purchase.
  await expect(page.getByRole('link', { name: 'Bag (0)' })).toBeVisible();

  // Hygiene: put back the unit of stock this order consumed.
  await restockAfterOrder(request, SAGE_LEHENGA, size);
});

// ---------------------------------------------------------------------------
// Spec 2 — payment failure then successful retry (desktop only)
// ---------------------------------------------------------------------------

test('payment failure shows an error and retrying succeeds', async ({ page, request }) => {
  await page.goto('/product/organza-trail-kaftan-celadon');
  await expect(page.getByRole('heading', { name: MOSS_GOWN, level: 1 })).toBeVisible();
  const size = await selectFirstAvailableSize(page);
  await page.getByRole('button', { name: 'Add to Bag' }).click();
  await cartDrawer(page).getByRole('button', { name: 'Checkout' }).click();

  await expect(page).toHaveURL(/\/checkout/);
  await fillCheckoutDetails(page, { email: uniqueEmail('guest-fail'), firstName: 'Riya' });
  await page.getByRole('button', { name: /Place Order/ }).click();

  // Simulate a failed payment in the masked Razorpay modal.
  const modal = razorpayModal(page);
  await expect(modal).toBeVisible();
  await modal.getByRole('button', { name: 'Simulate failure' }).click();

  // Error state: order saved, nothing charged, retry offered.
  const alert = page.getByRole('alert');
  await expect(alert).toContainText('Payment failed.');
  await expect(alert).toContainText('you can retry the payment');

  // Retry → modal reappears → pay → confirmation.
  await alert.getByRole('button', { name: 'Retry Payment' }).click();
  const orderNumber = await payAndConfirm(page);
  expect(orderNumber).toMatch(ORDER_NUMBER_RE);
  await expect(page.getByRole('heading', { name: /Thank you, Riya/ })).toBeVisible();

  await restockAfterOrder(request, MOSS_GOWN, size);
});

// ---------------------------------------------------------------------------
// Spec 3 — account: register, order while signed in, wishlist (desktop only)
// ---------------------------------------------------------------------------

test('registered customer sees their order in the account, and can manage the wishlist', async ({
  page,
  request,
}) => {
  const email = uniqueEmail('customer');

  // Register a fresh account.
  await page.goto('/login');
  await page.getByRole('button', { name: 'Create Account' }).click(); // tab
  const regForm = page.locator('form').filter({ hasText: 'Join the house' });
  await regForm.getByLabel('First Name').fill('Meera');
  await regForm.getByLabel('Last Name').fill('Kapoor');
  await regForm.getByLabel('Email').fill(email);
  await regForm.getByLabel('Password').fill('Meera@2026');
  await regForm.getByRole('button', { name: 'Create Account' }).click();
  await expect(page.getByRole('heading', { name: /Welcome back, Meera/ })).toBeVisible();

  // Place an order while logged in.
  await page.goto('/product/threadwork-anarkali-pistachio');
  await expect(page.getByRole('heading', { name: PISTACHIO_ANARKALI, level: 1 })).toBeVisible();
  const size = await selectFirstAvailableSize(page);
  await page.getByRole('button', { name: 'Add to Bag' }).click();
  await cartDrawer(page).getByRole('button', { name: 'Checkout' }).click();

  // Checkout prefills the signed-in customer's contact details.
  await expect(page.getByText('Signed in as Meera')).toBeVisible();
  await expect(page.getByLabel('Email Address')).toHaveValue(email);
  await fillCheckoutDetails(page, { email, firstName: 'Meera', lastName: 'Kapoor' });
  await page.getByRole('button', { name: /Place Order/ }).click();
  const orderNumber = await payAndConfirm(page);

  // Account page lists the order with a status badge.
  await page.goto('/account');
  const orderCard = page.locator('.order').filter({ hasText: orderNumber });
  await expect(orderCard).toHaveCount(1);
  await expect(orderCard).toContainText(PISTACHIO_ANARKALI);
  await expect(orderCard.locator('.badge')).toHaveText('In the Atelier');

  // Wishlist: save a piece from its PDP…
  await page.goto('/product/tissue-column-kaftan-fern');
  await page.getByRole('button', { name: 'Add to Wishlist' }).click();
  await expect(page.getByRole('button', { name: 'Saved to Wishlist' })).toBeVisible();

  // …see it on the wishlist page…
  await page.goto('/wishlist');
  const savedCard = page.locator('.pcard').filter({ hasText: FERN_GOWN });
  await expect(savedCard).toHaveCount(1);

  // …then remove it and get the empty state.
  await savedCard.getByRole('button', { name: 'Remove' }).click();
  await expect(page.getByRole('heading', { name: 'Your wishlist is empty' })).toBeVisible();

  await restockAfterOrder(request, PISTACHIO_ANARKALI, size);
});

// ---------------------------------------------------------------------------
// Spec — "This order contains": every piece listed, unticking reprices
// ---------------------------------------------------------------------------

test('PDP components: pieces are listed and unticking an optional one reprices', async ({
  page,
}) => {
  // Zardozi Court Lehenga: base ₹1,84,000 + optional Dupatta ₹12,000. Nothing
  // is ordered here, so no stock needs restoring.
  await page.goto('/product/zardozi-court-lehenga-sage');
  await expect(page.getByRole('heading', { name: SAGE_LEHENGA, level: 1 })).toBeVisible();
  await expect(page.getByText('This order contains')).toBeVisible();

  const includes = page.locator('.set-includes');
  const pieces = includes.locator('.piece');
  await expect(pieces).toHaveCount(2);
  await expect(pieces.nth(0)).toContainText('Lehenga');
  await expect(pieces.nth(1)).toContainText('Blouse');
  const dupatta = includes.locator('label.check').filter({ hasText: 'Dupatta' });
  await expect(dupatta).toContainText('₹12,000');
  await expect(dupatta.getByRole('checkbox')).toBeChecked();

  const price = page.locator('.pdp .info .price');
  await expect(price).toContainText('₹1,96,000');
  await dupatta.getByRole('checkbox').uncheck();
  await expect(price).toContainText('₹1,84,000');

  await selectFirstAvailableSize(page);
  await page.getByRole('button', { name: 'Add to Bag' }).click();
  const drawer = cartDrawer(page);
  await expect(drawer).toContainText(SAGE_LEHENGA);
  await expect(drawer.locator('.cd-subval')).toContainText('₹1,84,000');
});
