import { useEffect } from 'react';
import { formatINR } from '../lib/format';

interface RazorpayMockProps {
  open: boolean;
  amount: number; // paise
  orderNumber?: string;
  keyId?: string;
  busy?: boolean;
  onPay: () => void;
  onFail: () => void;
  onClose: () => void;
}

/** In-app masked Razorpay checkout — clearly labelled Test Mode.
 *  Real integration steps live in TODO-THIRD-PARTY.md. */
export default function RazorpayMock({
  open,
  amount,
  orderNumber,
  keyId,
  busy = false,
  onPay,
  onFail,
  onClose,
}: RazorpayMockProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="rzp-backdrop" role="dialog" aria-modal="true" aria-label="Razorpay · Test Mode">
      <div className="rzp">
        <div className="rzp-head">
          <span className="brand">Razorpay · Test Mode</span>
          <span className="mode">Masked</span>
          <button className="x" aria-label="Close payment" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="rzp-body">
          <div className="rzp-note">
            <strong>Test mode.</strong> This is a masked in-app mock of Razorpay Checkout — no real
            payment is processed.
          </div>
          {orderNumber && (
            <div className="rzp-row">
              <span>Order</span>
              <span className="v">{orderNumber}</span>
            </div>
          )}
          <div className="rzp-row">
            <span>Merchant</span>
            <span className="v">Tanvi Agnihotry</span>
          </div>
          <div className="rzp-row">
            <span>Key</span>
            <span className="v">{keyId ?? 'rzp_test_MASKED'}</span>
          </div>
          <div className="rzp-amount">
            <span className="l">Amount</span>
            <span className="v">{formatINR(amount)}</span>
          </div>
        </div>
        <div className="rzp-actions">
          <button className="btn-buy gold" disabled={busy} onClick={onPay}>
            Pay {formatINR(amount)}
          </button>
          <button className="btn-outline" disabled={busy} onClick={onFail}>
            Simulate failure
          </button>
        </div>
      </div>
    </div>
  );
}
