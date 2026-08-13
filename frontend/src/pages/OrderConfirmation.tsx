import { useEffect, useState } from 'react';
import { Link, useLocation, useParams, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import type { Order, OrderStatus } from '../lib/types';
import { useAuth } from '../lib/auth';
import { formatINR } from '../lib/format';
import Shop from '../components/Shop';
import ImageSlot from '../components/ImageSlot';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/confirmation.css';

const TIMELINE: Array<{ t: string; d: string }> = [
  { t: 'Order placed', d: 'Today · payment confirmed' },
  { t: 'Stylist consultation', d: 'Within 48 hours · measurements confirmed' },
  { t: 'In the atelier', d: 'Hand-embroidery & tailoring · 3–5 weeks' },
  { t: 'Quality & finishing', d: 'Final press & inspection' },
  { t: 'Dispatched', d: 'Insured, tracked worldwide' },
];

const DONE_STEPS: Record<OrderStatus, number> = {
  pending_payment: 1,
  paid: 2,
  in_atelier: 3,
  quality_check: 4,
  dispatched: 5,
  delivered: 5,
  cancelled: 1,
};

export default function OrderConfirmation() {
  const { orderNumber = '' } = useParams();
  const [params] = useSearchParams();
  const location = useLocation();
  const { token } = useAuth();
  const stateOrder = (location.state as { order?: Order } | null)?.order;

  const [order, setOrder] = useState<Order | null>(
    stateOrder && stateOrder.orderNumber === orderNumber ? stateOrder : null,
  );
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(order === null);

  const email = params.get('email') ?? '';

  useEffect(() => {
    if (order && order.orderNumber === orderNumber) return;
    let cancelled = false;
    setLoading(true);
    setError(null);
    const path = email
      ? `/api/orders/${encodeURIComponent(orderNumber)}?email=${encodeURIComponent(email)}`
      : `/api/orders/${encodeURIComponent(orderNumber)}`;
    api
      .get<Order>(path)
      .then((o) => {
        if (!cancelled) setOrder(o);
      })
      .catch((e: { status?: number; message?: string }) => {
        if (!cancelled) {
          setError(
            e.status === 404
              ? 'We could not find that order. Check your order number and email.'
              : (e.message ?? 'Unable to load your order right now.'),
          );
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [orderNumber, email, token, order]);

  const done = order ? DONE_STEPS[order.status] : 2;

  return (
    <Shop page="page-oc">
      <main className="oc">
        {loading ? (
          <p className="api-note">Retrieving your order…</p>
        ) : error || !order ? (
          <div className="oc-top">
            <div className="oc-seal">✕</div>
            <span className="eyebrow">Order Lookup</span>
            <h1>Order not found.</h1>
            <p>{error ?? 'Unable to load your order right now.'}</p>
          </div>
        ) : (
          <>
            <div className="oc-top">
              <div className="oc-seal">✓</div>
              <span className="eyebrow">Order Confirmed</span>
              <h1>Thank you, {order.firstName}.</h1>
              <p>
                Your order is received and our atelier has begun. A confirmation has been sent to{' '}
                {order.email} — a stylist will reach out within 48 hours to confirm your
                measurements.
              </p>
            </div>

            <div className="oc-meta">
              <div className="cell">
                <div className="k">Order Number</div>
                <div className="v">{order.orderNumber}</div>
              </div>
              <div className="cell">
                <div className="k">Estimated Dispatch</div>
                <div className="v">{order.deliveryMethod === 'priority' ? '3–4 weeks' : '4–6 weeks'}</div>
              </div>
              <div className="cell">
                <div className="k">Shipping To</div>
                <div className="v">
                  {order.city}, {order.state} {order.pincode}
                </div>
              </div>
            </div>

            <div className="oc-grid">
              <div className="oc-block">
                <h3>What happens next</h3>
                <div className="timeline">
                  {TIMELINE.map((step, i) => (
                    <div className={`tl${i < done ? ' done' : ''}`} key={step.t}>
                      <div className="t">{step.t}</div>
                      <div className="d">{step.d}</div>
                    </div>
                  ))}
                </div>
              </div>

              <aside className="oc-block">
                <h3>Your order</h3>
                <div className="oc-items">
                  {order.items.map((it) => (
                    <div className="oc-line" key={it.id}>
                      <ImageSlot src={it.imageUrl} label={it.productName} alt={it.productName} />
                      <div>
                        <div className="nm">{it.productName}</div>
                        <div className="at">
                          {[it.color, it.size, `Qty ${it.quantity}`].filter(Boolean).join(' · ')}
                          {it.components.length > 0 &&
                            ` · With ${it.components.map((c) => c.name).join(' & ')}`}
                        </div>
                      </div>
                      <div className="pr">{formatINR(it.unitPrice * it.quantity)}</div>
                    </div>
                  ))}
                  <div className="oc-tot">
                    <span className="l">
                      {order.channel !== 'online' && order.balance > 0 ? 'Total' : 'Total Paid'}
                    </span>
                    <span className="v">{formatINR(order.total)}</span>
                  </div>
                  {order.channel !== 'online' && order.balance > 0 && (
                    <div className="oc-tot">
                      <span className="l">Balance due on delivery</span>
                      <span className="v">{formatINR(order.balance)}</span>
                    </div>
                  )}
                </div>
              </aside>
            </div>

            <div className="oc-cta">
              <Link className="btn-buy" to="/account">
                Track in My Account
              </Link>
              <Link className="btn-outline" to="/collection">
                Continue Shopping
              </Link>
            </div>
          </>
        )}
      </main>
      <Reveal watch={order?.id ?? error} />
      <Ambient watch={order?.id} />
    </Shop>
  );
}
