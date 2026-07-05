import { beforeEach, describe, expect, it } from 'vitest';
import { createOrdersService } from '../src/services/orders.service';
import { MockRazorpayProvider, PaymentsService, createPaymentsService } from '../src/services/payments.service';
import { Order } from '../src/types';
import { FakeOrdersRepo, FakePaymentProvider, FakePaymentsRepo, FakeProductsRepo, fakeTx, seedCatalog } from './fakes';

describe('MockRazorpayProvider', () => {
  it('is masked: rzp_test_MASKED key and order_MOCK ids', async () => {
    const provider = new MockRazorpayProvider();
    expect(provider.keyId).toBe('rzp_test_MASKED');
    const { providerOrderId } = await provider.createProviderOrder(100, 'TA-2026-00001');
    expect(providerOrderId).toMatch(/^order_MOCK/);
    const second = await provider.createProviderOrder(100, 'TA-2026-00002');
    expect(second.providerOrderId).not.toBe(providerOrderId);
  });
});

describe('PaymentsService', () => {
  let ordersRepo: FakeOrdersRepo;
  let paymentsRepo: FakePaymentsRepo;
  let provider: FakePaymentProvider;
  let service: PaymentsService;
  let order: Order;

  beforeEach(async () => {
    const products = new FakeProductsRepo();
    const seeded = await seedCatalog(products);
    ordersRepo = new FakeOrdersRepo();
    paymentsRepo = new FakePaymentsRepo(ordersRepo);
    provider = new FakePaymentProvider();
    service = createPaymentsService({ payments: paymentsRepo, orders: ordersRepo, provider });
    order = await createOrdersService({ products, orders: ordersRepo, runInTransaction: fakeTx }).createOrder({
      customer: {
        email: 'guest@example.com',
        firstName: 'Guest',
        addressLine1: '12 Marine Drive',
        city: 'Mumbai',
        state: 'Maharashtra',
        pincode: '400001',
      },
      deliveryMethod: 'standard',
      items: [{ variantId: seeded.sage.variants[0].id, quantity: 1 }],
    });
  });

  describe('checkout', () => {
    it('creates a payment in created status for the order total', async () => {
      const res = await service.checkout(order.id);
      expect(res).toEqual({
        paymentId: expect.any(String),
        providerOrderId: expect.stringMatching(/^order_MOCK/),
        keyId: 'rzp_test_MASKED',
        amount: order.total,
        currency: 'INR',
        mock: true,
      });
      const payment = await paymentsRepo.getById(res.paymentId);
      expect(payment).toMatchObject({
        orderId: order.id,
        provider: 'razorpay_mock',
        status: 'created',
        amount: order.total,
        providerPaymentId: null,
      });
      expect(provider.calls).toEqual([{ amountPaise: order.total, receipt: order.orderNumber }]);
    });

    it('throws NOT_FOUND for a missing order', async () => {
      await expect(service.checkout('ghost')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('allows retrying checkout while no payment is captured', async () => {
      const first = await service.checkout(order.id);
      const second = await service.checkout(order.id);
      expect(second.paymentId).not.toBe(first.paymentId);
      expect(await paymentsRepo.getByOrderId(order.id)).toHaveLength(2);
    });

    it('throws PAYMENT_ALREADY_FINAL once a payment is captured', async () => {
      const { paymentId } = await service.checkout(order.id);
      await service.confirm(paymentId, 'success');
      await expect(service.checkout(order.id)).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_FINAL' });
    });

    it('throws PAYMENT_ALREADY_FINAL for orders no longer pending payment (even without a captured row)', async () => {
      await ordersRepo.updateStatus(order.id, 'paid'); // e.g. admin-marked paid
      await expect(service.checkout(order.id)).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_FINAL' });
      await ordersRepo.updateStatus(order.id, 'cancelled');
      await expect(service.checkout(order.id)).rejects.toMatchObject({ code: 'PAYMENT_ALREADY_FINAL' });
    });
  });

  describe('confirm', () => {
    it('success: captures the payment and marks the order paid', async () => {
      const { paymentId } = await service.checkout(order.id);
      const res = await service.confirm(paymentId, 'success');
      expect(res.payment.status).toBe('captured');
      expect(res.payment.providerPaymentId).toMatch(/^pay_MOCK/);
      expect(res.order?.status).toBe('paid');
      expect((await ordersRepo.getById(order.id))?.status).toBe('paid');
    });

    it('failure: fails the payment, order stays pending_payment (retryable)', async () => {
      const { paymentId } = await service.checkout(order.id);
      const res = await service.confirm(paymentId, 'failure');
      expect(res.payment.status).toBe('failed');
      expect(res.payment.providerPaymentId).toBeNull();
      expect(res.order?.status).toBe('pending_payment');
    });

    it('a failed payment can be retried to success', async () => {
      const { paymentId } = await service.checkout(order.id);
      await service.confirm(paymentId, 'failure');
      const res = await service.confirm(paymentId, 'success');
      expect(res.payment.status).toBe('captured');
      expect(res.order?.status).toBe('paid');
    });

    it('confirming an already-captured payment is idempotent', async () => {
      const { paymentId } = await service.checkout(order.id);
      const first = await service.confirm(paymentId, 'success');
      const again = await service.confirm(paymentId, 'success');
      expect(again.payment).toEqual(first.payment); // unchanged, same providerPaymentId
      expect(again.order?.status).toBe('paid');
      const failAttempt = await service.confirm(paymentId, 'failure');
      expect(failAttempt.payment.status).toBe('captured'); // failure after capture is a no-op
    });

    it('throws NOT_FOUND for an unknown payment', async () => {
      await expect(service.confirm('ghost', 'success')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    });

    it('refuses to capture a stale payment once the order left pending_payment', async () => {
      const a = await service.checkout(order.id);
      const b = await service.checkout(order.id);
      await service.confirm(a.paymentId, 'success');
      await ordersRepo.updateStatus(order.id, 'in_atelier');
      // The stale second payment must not be captured nor reset the order status.
      await expect(service.confirm(b.paymentId, 'success')).rejects.toMatchObject({
        code: 'PAYMENT_ALREADY_FINAL',
      });
      expect((await paymentsRepo.getById(b.paymentId))?.status).toBe('created');
      expect((await ordersRepo.getById(order.id))?.status).toBe('in_atelier');
    });
  });
});
