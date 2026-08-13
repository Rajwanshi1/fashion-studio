import { describe, expect, it } from 'vitest';
import { screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { mockFetch, ORDER, renderApp, seedCart, withStatus } from './helpers';

const PAYMENT = {
  paymentId: 'pay1',
  providerOrderId: 'order_MOCK123',
  keyId: 'rzp_test_MASKED',
  amount: 18400000,
  currency: 'INR',
  mock: true,
};

function checkoutRoutes(url: string, init?: RequestInit) {
  const method = init?.method ?? 'GET';
  if (url.endsWith('/api/orders') && method === 'POST') return ORDER;
  if (url.includes('/api/payments/checkout')) return PAYMENT;
  if (url.includes('/api/payments/confirm')) return { ok: true };
  if (url.includes('/api/orders/TA-2026-04817')) return { ...ORDER, status: 'paid' };
  if (url.includes('/api/categories')) return [];
  if (url.includes('/api/products')) return { items: [], total: 0, page: 1, pages: 1 };
  return undefined;
}

async function fillForm(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByLabelText('Email Address'), 'aanya@example.com');
  await user.type(screen.getByLabelText('Mobile Number'), '+91 90000 00000');
  await user.type(screen.getByLabelText('First Name'), 'Aanya');
  await user.type(screen.getByLabelText('Last Name'), 'Mehra');
  await user.type(screen.getByLabelText('Address'), '12 Sea Breeze, Altamount Road');
  await user.type(screen.getByLabelText('City'), 'Mumbai');
  await user.type(screen.getByLabelText('PIN Code'), '400026');
}

describe('checkout', () => {
  it('happy path: place order → mock Razorpay → success → confirmation', async () => {
    seedCart();
    const fetchMock = mockFetch(checkoutRoutes);
    renderApp('/checkout');

    expect(screen.getByText('Secure Checkout')).toBeInTheDocument();
    expect(screen.getByText('Order Summary')).toBeInTheDocument();

    const user = userEvent.setup();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Place Order · ₹1,84,000' }));

    // Masked Razorpay test-mode modal opens.
    const dialog = await screen.findByRole('dialog', { name: 'Razorpay · Test Mode' });
    expect(dialog).toBeInTheDocument();
    expect(screen.getByText('rzp_test_MASKED')).toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: 'Pay ₹1,84,000' }));

    // Confirmation page.
    expect(await screen.findByText('Thank you, Aanya.')).toBeInTheDocument();
    expect(screen.getByText('TA-2026-04817')).toBeInTheDocument();
    expect(screen.getByText('Total Paid')).toBeInTheDocument();

    // Cart was cleared and the payment was confirmed as success.
    expect(JSON.parse(localStorage.getItem('ta.cart') ?? '[]')).toHaveLength(0);
    const confirmCall = fetchMock.mock.calls.find((c) =>
      String(c[0]).includes('/api/payments/confirm'),
    );
    expect(confirmCall).toBeTruthy();
    expect(String(confirmCall?.[1]?.body)).toContain('"outcome":"success"');
  });

  it('sends measurements and excluded components per line, omitting empties', async () => {
    seedCart(); // line 1: plain, no note, nothing unticked
    const cart = JSON.parse(localStorage.getItem('ta.cart') ?? '[]');
    cart.push({
      ...cart[0],
      variantId: 'v4',
      size: 'Custom',
      measurements: 'bust 36in, waist 30in',
      excludedComponents: ['Jacket'],
    });
    localStorage.setItem('ta.cart', JSON.stringify(cart));
    const fetchMock = mockFetch(checkoutRoutes);
    renderApp('/checkout');

    const user = userEvent.setup();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: /Place Order/ }));
    await screen.findByRole('dialog', { name: 'Razorpay · Test Mode' });

    const orderCall = fetchMock.mock.calls.find(
      (c) => String(c[0]).endsWith('/api/orders') && c[1]?.method === 'POST',
    );
    const body = JSON.parse(String(orderCall?.[1]?.body));
    expect(body.items).toHaveLength(2);
    expect(body.items[0]).not.toHaveProperty('measurements'); // empty note omitted
    expect(body.items[0]).not.toHaveProperty('excludedComponents'); // nothing unticked omitted
    expect(body.items[1].measurements).toBe('bust 36in, waist 30in');
    expect(body.items[1].excludedComponents).toEqual(['Jacket']);
    // Every line ships the price it displayed — the server 409s on drift.
    expect(body.items[0].expectedUnitPrice).toBeGreaterThan(0);
    expect(body.items[1].expectedUnitPrice).toBe(body.items[0].expectedUnitPrice);
  });

  it('payments disabled: 503 from checkout shows the coming-soon notice, order saved', async () => {
    seedCart();
    mockFetch((url, init) => {
      if (url.includes('/api/payments/checkout'))
        return withStatus(503, { error: 'Online payments are not available yet' });
      return checkoutRoutes(url, init);
    });
    renderApp('/checkout');

    const user = userEvent.setup();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Place Order · ₹1,84,000' }));

    // Calm notice, not the red error banner and no Razorpay modal.
    await screen.findByText('Online payments are coming soon.');
    const note = document.querySelector('.pay-note') as HTMLElement;
    expect(note).toHaveTextContent('TA-2026-04817');
    expect(note).toHaveTextContent('aanya@example.com');
    expect(screen.queryByRole('dialog', { name: 'Razorpay · Test Mode' })).not.toBeInTheDocument();
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();
    // Placing again is blocked (the order already exists server-side).
    expect(screen.getByRole('button', { name: /Place Order/ })).toBeDisabled();
  });

  it('failure path: simulate failure → retryable error state', async () => {
    seedCart();
    const fetchMock = mockFetch(checkoutRoutes);
    renderApp('/checkout');

    const user = userEvent.setup();
    await fillForm(user);
    await user.click(screen.getByRole('button', { name: 'Place Order · ₹1,84,000' }));

    await screen.findByRole('dialog', { name: 'Razorpay · Test Mode' });
    await user.click(screen.getByRole('button', { name: 'Simulate failure' }));

    // Modal closes; retryable error banner appears; cart is intact.
    await waitFor(() =>
      expect(screen.queryByRole('dialog', { name: 'Razorpay · Test Mode' })).not.toBeInTheDocument(),
    );
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('Payment failed.');
    expect(JSON.parse(localStorage.getItem('ta.cart') ?? '[]')).toHaveLength(1);

    // Retry re-opens the masked modal via a fresh payments/checkout call.
    const checkoutCallsBefore = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/payments/checkout'),
    ).length;
    await user.click(screen.getByRole('button', { name: 'Retry Payment' }));
    await screen.findByRole('dialog', { name: 'Razorpay · Test Mode' });
    const checkoutCallsAfter = fetchMock.mock.calls.filter((c) =>
      String(c[0]).includes('/api/payments/checkout'),
    ).length;
    expect(checkoutCallsAfter).toBe(checkoutCallsBefore + 1);
  });
});
