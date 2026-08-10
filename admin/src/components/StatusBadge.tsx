import type { OrderStatus, PaymentStatus } from '../lib/types';
import { ORDER_STATUS_LABELS } from '../lib/types';

type BadgeStatus = OrderStatus | PaymentStatus | 'received';

/** Mirrors the storefront badge language (Account.html) and extends it. */
const TONE: Record<BadgeStatus, string> = {
  pending_payment: 'pending',
  paid: 'paid',
  in_atelier: 'crafting',
  quality_check: 'crafting',
  dispatched: 'dispatched',
  delivered: 'delivered',
  cancelled: 'muted',
  created: 'pending',
  captured: 'paid',
  failed: 'muted',
  refunded: 'muted',
  received: 'paid',
};

const PAYMENT_LABELS: Record<PaymentStatus | 'received', string> = {
  created: 'Created',
  captured: 'Captured',
  failed: 'Failed',
  refunded: 'Refunded',
  received: 'Received',
};

export default function StatusBadge({ status }: { status: BadgeStatus }) {
  const label =
    status in ORDER_STATUS_LABELS
      ? ORDER_STATUS_LABELS[status as OrderStatus]
      : PAYMENT_LABELS[status as PaymentStatus | 'received'];
  return <span className={`badge ${TONE[status]}`}>{label}</span>;
}
