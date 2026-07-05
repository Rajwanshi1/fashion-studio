import type { OrdersRepo } from '../data/orders.repo';
import type { PaymentsRepo } from '../data/payments.repo';
import { DomainError, Order, Payment } from '../types';

/** Masked Razorpay seam — swap MockRazorpayProvider for the real SDK later. */
export interface PaymentProvider {
  keyId: string;
  createProviderOrder(amountPaise: number, receipt: string): Promise<{ providerOrderId: string }>;
}

export class MockRazorpayProvider implements PaymentProvider {
  keyId = 'rzp_test_MASKED';

  async createProviderOrder(_amountPaise: number, _receipt: string): Promise<{ providerOrderId: string }> {
    return { providerOrderId: `order_MOCK${randomId()}` };
  }
}

function randomId(): string {
  return Math.random().toString(36).slice(2, 12);
}

export interface CheckoutResult {
  paymentId: string;
  providerOrderId: string;
  keyId: string;
  amount: number;
  currency: string;
  mock: true;
}

export interface ConfirmResult {
  payment: Payment;
  order: Order | null;
}

export interface PaymentsService {
  checkout(orderId: string): Promise<CheckoutResult>;
  confirm(paymentId: string, outcome: 'success' | 'failure'): Promise<ConfirmResult>;
}

export function createPaymentsService(deps: {
  payments: PaymentsRepo;
  orders: OrdersRepo;
  provider: PaymentProvider;
}): PaymentsService {
  return {
    async checkout(orderId) {
      const order = await deps.orders.getById(orderId);
      if (!order) throw new DomainError('NOT_FOUND', 'Order not found');
      // Only orders still awaiting payment can be checked out (covers admin-marked
      // paid/cancelled orders that have no captured payment row).
      if (order.status !== 'pending_payment') {
        throw new DomainError('PAYMENT_ALREADY_FINAL', 'This order can no longer be paid');
      }
      const existing = await deps.payments.getByOrderId(orderId);
      if (existing.some((p) => p.status === 'captured')) {
        throw new DomainError('PAYMENT_ALREADY_FINAL', 'This order has already been paid');
      }
      const { providerOrderId } = await deps.provider.createProviderOrder(order.total, order.orderNumber);
      const payment = await deps.payments.create({
        orderId,
        provider: 'razorpay_mock',
        providerOrderId,
        amount: order.total,
        currency: 'INR',
        status: 'created',
        method: '',
      });
      return {
        paymentId: payment.id,
        providerOrderId,
        keyId: deps.provider.keyId,
        amount: payment.amount,
        currency: payment.currency,
        mock: true,
      };
    },

    // SECURITY (accepted risk, mock-only): the client-supplied `outcome` is a
    // MOCK simulation of the Razorpay handler + webhook. A real integration
    // MUST NOT trust the client — it must verify Razorpay's HMAC signature
    // server-side and/or rely on the signed webhook (see TODO-THIRD-PARTY.md).
    async confirm(paymentId, outcome) {
      const payment = await deps.payments.getById(paymentId);
      if (!payment) throw new DomainError('NOT_FOUND', 'Payment not found');
      // Idempotent: confirming a captured payment returns it unchanged.
      if (payment.status === 'captured') {
        return { payment, order: await deps.orders.getById(payment.orderId) };
      }
      if (payment.status === 'refunded') {
        throw new DomainError('PAYMENT_ALREADY_FINAL', 'This payment has already been refunded');
      }

      if (outcome === 'success') {
        // Never capture a stale payment for an order that already left
        // pending_payment (e.g. paid via another payment, or cancelled).
        const current = await deps.orders.getById(payment.orderId);
        if (current && current.status !== 'pending_payment') {
          throw new DomainError('PAYMENT_ALREADY_FINAL', 'This order can no longer be paid');
        }
        const captured = (await deps.payments.updateStatus(paymentId, 'captured', `pay_MOCK${randomId()}`))!;
        let order = current;
        if (order && order.status === 'pending_payment') {
          order = await deps.orders.updateStatus(order.id, 'paid');
        }
        return { payment: captured, order };
      }

      // Failure: payment failed, order stays pending_payment (retryable).
      const failed = (await deps.payments.updateStatus(paymentId, 'failed'))!;
      return { payment: failed, order: await deps.orders.getById(payment.orderId) };
    },
  };
}
