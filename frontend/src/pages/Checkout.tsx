import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api, type ApiError } from '../lib/api';
import type { DeliveryMethod, Order, PaymentInit } from '../lib/types';
import { cartLineKey, useCart } from '../lib/cart';
import { useAuth } from '../lib/auth';
import { track } from '../lib/analytics';
import { formatINR } from '../lib/format';
import { useToast } from '../components/Toast';
import ImageSlot from '../components/ImageSlot';
import RazorpayMock from '../components/RazorpayMock';
import BrandLogo from '../components/BrandLogo';
import '../styles/checkout.css';
import { usePageTitle } from '../lib/usePageTitle';

const PRIORITY_FEE = 250000; // paise (₹2,500)

const STATES = ['Maharashtra', 'Delhi', 'Karnataka', 'Gujarat', 'Tamil Nadu', 'West Bengal'];
const COUNTRIES = ['India', 'United Arab Emirates', 'United Kingdom', 'United States', 'Singapore'];

type PayMethod = 'card' | 'upi' | 'cod';

export default function Checkout() {
  usePageTitle('Checkout');
  const { items, subtotal, count, clear } = useCart();
  const { user } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [email, setEmail] = useState(user?.email ?? '');
  const [phone, setPhone] = useState('');
  const [firstName, setFirstName] = useState(user?.firstName ?? '');
  const [lastName, setLastName] = useState(user?.lastName ?? '');
  const [addressLine1, setAddressLine1] = useState('');
  const [addressLine2, setAddressLine2] = useState('');
  const [city, setCity] = useState('');
  const [pincode, setPincode] = useState('');
  const [stateName, setStateName] = useState(STATES[0]);
  const [country, setCountry] = useState(COUNTRIES[0]);
  const [delivery, setDelivery] = useState<DeliveryMethod>('standard');
  const [payMethod, setPayMethod] = useState<PayMethod>('card');

  const [order, setOrder] = useState<Order | null>(null);
  const [payment, setPayment] = useState<PaymentInit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  const [paymentsUnavailable, setPaymentsUnavailable] = useState(false);

  const deliveryFee = delivery === 'priority' ? PRIORITY_FEE : 0;
  const total = subtotal + deliveryFee;

  const checkoutStartedRef = useRef(false);
  useEffect(() => {
    if (checkoutStartedRef.current || items.length === 0) return;
    checkoutStartedRef.current = true;
    track('checkout_start', { props: { itemCount: count, subtotal } });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startPayment = async (existing: Order | null) => {
    setBusy(true);
    setError(null);
    try {
      let ord = existing;
      if (!ord) {
        ord = await api.post<Order>('/api/orders', {
          customer: {
            email,
            phone,
            firstName,
            lastName,
            addressLine1,
            addressLine2,
            city,
            state: stateName,
            pincode,
            country,
          },
          deliveryMethod: delivery,
          items: items.map((i) => ({
            variantId: i.variantId,
            quantity: i.qty,
            excludedComponents: i.excludedComponents.length ? i.excludedComponents : undefined, // omit empties
            // The server 409s if it would charge anything other than this — a
            // stale cart is asked to review, never silently repriced.
            expectedUnitPrice: i.unitPrice,
            customColor: i.customColor || undefined, // omit empties
            measurements: i.measurements || undefined, // omit empties
          })),
        });
        setOrder(ord);
      }
      try {
        const pay = await api.post<PaymentInit>('/api/payments/checkout', { orderId: ord.id, email });
        setPayment(pay);
        track('checkout_step', { props: { step: 'payment_opened' } });
        setFailed(false);
      } catch (e) {
        // 503 = payments not enabled yet; the order itself is saved and the
        // atelier can follow up, so this is a notice, not an error.
        if ((e as ApiError).status !== 503) throw e;
        setPaymentsUnavailable(true);
        setFailed(false);
      }
    } catch (e) {
      const err = e as { message?: string };
      setError(err.message ?? 'Something went wrong placing your order.');
    } finally {
      setBusy(false);
    }
  };

  const placeOrder = (e: FormEvent) => {
    e.preventDefault();
    if (items.length === 0 || busy) return;
    track('checkout_step', { props: { step: 'info_submitted' } });
    void startPayment(order);
  };

  const onPay = async () => {
    if (!payment || !order) return;
    setBusy(true);
    try {
      await api.post('/api/payments/confirm', { paymentId: payment.paymentId, outcome: 'success', email });
      track('payment_result', { props: { outcome: 'success' } });
      track('order_placed', {
        props: {
          orderId: order.id,
          orderNumber: order.orderNumber,
          total,
          subtotal,
          deliveryFee,
          itemCount: count,
          items: items.map((i) => ({
            productId: i.productId,
            variantId: i.variantId,
            qty: i.qty,
            unitPrice: i.unitPrice,
          })),
        },
      });
      clear();
      navigate(`/order/${order.orderNumber}?email=${encodeURIComponent(email)}`, {
        state: { order: { ...order, status: 'paid' } },
      });
    } catch (e) {
      const err = e as { message?: string };
      track('payment_result', { props: { outcome: 'failure' } });
      setPayment(null);
      setFailed(true);
      setError(err.message ?? 'Payment could not be confirmed.');
    } finally {
      setBusy(false);
    }
  };

  const onFail = async () => {
    if (!payment) return;
    setBusy(true);
    track('payment_result', { props: { outcome: 'failure' } });
    try {
      await api.post('/api/payments/confirm', { paymentId: payment.paymentId, outcome: 'failure', email });
    } catch {
      /* the failure state below covers it */
    } finally {
      setPayment(null);
      setFailed(true);
      setError(null);
      setBusy(false);
    }
  };

  return (
    <div className="page-checkout">
      <div className="co-nav">
        <Link className="back" to="/cart">
          ← Back to Bag
        </Link>
        <div className="wordmark">
          <BrandLogo />
          Tanvi Agnihotry
        </div>
        <div className="secure">
          <span className="lock">🔒</span> Secure Checkout
        </div>
      </div>

      <main className="co">
        {/* FORM */}
        <section className="co-form">
          <div className="steps">
            <span>Bag</span>
            <span className="sep">→</span>
            <span className="on">Information</span>
            <span className="sep">→</span>
            <span>Payment</span>
            <span className="sep">→</span>
            <span>Confirm</span>
          </div>

          {items.length === 0 ? (
            <p className="api-note">
              Your bag is empty. <Link to="/collection/lehenga">Explore the collection →</Link>
            </p>
          ) : (
            <form onSubmit={placeOrder}>
              {/* express */}
              <div className="block">
                <div className="express">
                  <button type="button" onClick={() => showToast('Express checkout — coming soon')}>
                    Pay with UPI
                  </button>
                  <button type="button" onClick={() => showToast('Express checkout — coming soon')}>
                    Pay with Wallet
                  </button>
                </div>
                <div className="or">or check out with details</div>
              </div>

              {paymentsUnavailable && order && (
                <div className="pay-note" role="status">
                  <span>
                    <strong>Online payments are coming soon.</strong> Your order{' '}
                    {order.orderNumber} is saved — the atelier will contact you at {email} to
                    arrange payment.
                  </span>
                </div>
              )}

              {!paymentsUnavailable && (failed || error) && (
                <div className="pay-error" role="alert">
                  <span>
                    <strong>{failed ? 'Payment failed.' : 'We hit a snag.'}</strong>{' '}
                    {failed
                      ? 'No amount was charged. Your order is saved — you can retry the payment.'
                      : error}
                  </span>
                  {(failed || order) && (
                    <button
                      type="button"
                      className="btn-outline"
                      disabled={busy}
                      onClick={() => void startPayment(order)}
                    >
                      Retry Payment
                    </button>
                  )}
                </div>
              )}

              {/* contact */}
              <div className="block">
                <div className="bh">
                  <h3>Contact</h3>
                  <span className="alt">
                    {user ? (
                      <>Signed in as {user.firstName}</>
                    ) : (
                      <>
                        Have an account? <Link to="/login">Sign in</Link>
                      </>
                    )}
                  </span>
                </div>
                <div className="field">
                  <label className="lab" htmlFor="co-email">
                    Email Address
                  </label>
                  <input
                    id="co-email"
                    className="inp"
                    type="email"
                    placeholder="you@example.com"
                    required
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="lab" htmlFor="co-phone">
                    Mobile Number
                  </label>
                  <input
                    id="co-phone"
                    className="inp"
                    type="tel"
                    placeholder="+91 90000 00000"
                    required
                    value={phone}
                    onChange={(e) => setPhone(e.target.value)}
                  />
                </div>
                <label className="check">
                  <input type="checkbox" defaultChecked /> Keep me updated on my order &amp; new
                  collections
                </label>
              </div>

              {/* shipping */}
              <div className="block">
                <div className="bh">
                  <h3>Shipping Address</h3>
                  <span className="num">01 / 03</span>
                </div>
                <div className="grid2">
                  <div className="field">
                    <label className="lab" htmlFor="co-first">
                      First Name
                    </label>
                    <input
                      id="co-first"
                      className="inp"
                      placeholder="First name"
                      required
                      value={firstName}
                      onChange={(e) => setFirstName(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label className="lab" htmlFor="co-last">
                      Last Name
                    </label>
                    <input
                      id="co-last"
                      className="inp"
                      placeholder="Last name"
                      required
                      value={lastName}
                      onChange={(e) => setLastName(e.target.value)}
                    />
                  </div>
                </div>
                <div className="field">
                  <label className="lab" htmlFor="co-addr">
                    Address
                  </label>
                  <input
                    id="co-addr"
                    className="inp"
                    placeholder="House no., street, area"
                    required
                    value={addressLine1}
                    onChange={(e) => setAddressLine1(e.target.value)}
                  />
                </div>
                <div className="field">
                  <label className="lab" htmlFor="co-addr2">
                    Apartment, landmark (optional)
                  </label>
                  <input
                    id="co-addr2"
                    className="inp"
                    placeholder="Apartment, suite, landmark"
                    value={addressLine2}
                    onChange={(e) => setAddressLine2(e.target.value)}
                  />
                </div>
                <div className="grid2">
                  <div className="field">
                    <label className="lab" htmlFor="co-city">
                      City
                    </label>
                    <input
                      id="co-city"
                      className="inp"
                      placeholder="City"
                      required
                      value={city}
                      onChange={(e) => setCity(e.target.value)}
                    />
                  </div>
                  <div className="field">
                    <label className="lab" htmlFor="co-pin">
                      PIN Code
                    </label>
                    <input
                      id="co-pin"
                      className="inp"
                      placeholder="000000"
                      required
                      value={pincode}
                      onChange={(e) => setPincode(e.target.value)}
                    />
                  </div>
                </div>
                <div className="grid2">
                  <div className="field">
                    <label className="lab" htmlFor="co-state">
                      State
                    </label>
                    <select
                      id="co-state"
                      className="inp"
                      value={stateName}
                      onChange={(e) => setStateName(e.target.value)}
                    >
                      {STATES.map((s) => (
                        <option key={s}>{s}</option>
                      ))}
                    </select>
                  </div>
                  <div className="field">
                    <label className="lab" htmlFor="co-country">
                      Country
                    </label>
                    <select
                      id="co-country"
                      className="inp"
                      value={country}
                      onChange={(e) => setCountry(e.target.value)}
                    >
                      {COUNTRIES.map((c) => (
                        <option key={c}>{c}</option>
                      ))}
                    </select>
                  </div>
                </div>
              </div>

              {/* delivery */}
              <div className="block">
                <div className="bh">
                  <h3>Delivery</h3>
                  <span className="num">02 / 03</span>
                </div>
                <div
                  className={`opt-row${delivery === 'standard' ? ' sel' : ''}`}
                  onClick={() => setDelivery('standard')}
                >
                  <span className="radio"></span>
                  <div className="ot">
                    <div className="t">Made-to-Order Atelier Dispatch</div>
                    <div className="d">Crafted &amp; shipped in 4–6 weeks · insured</div>
                  </div>
                  <span className="op">Complimentary</span>
                </div>
                <div
                  className={`opt-row${delivery === 'priority' ? ' sel' : ''}`}
                  onClick={() => setDelivery('priority')}
                >
                  <span className="radio"></span>
                  <div className="ot">
                    <div className="t">Priority Made-to-Order</div>
                    <div className="d">Expedited craft &amp; shipping · 3–4 weeks</div>
                  </div>
                  <span className="op">₹2,500</span>
                </div>
              </div>

              {/* payment */}
              <div className="block">
                <div className="bh">
                  <h3>Payment</h3>
                  <span className="num">03 / 03</span>
                </div>
                <div
                  className={`opt-row${payMethod === 'card' ? ' sel' : ''}`}
                  onClick={() => {
                    setPayMethod('card');
                    track('checkout_step', { props: { step: 'method_selected', method: 'card' } });
                  }}
                >
                  <span className="radio"></span>
                  <div className="ot">
                    <div className="t">Credit / Debit Card</div>
                  </div>
                  <span className="op small">Visa · MC · Amex</span>
                </div>
                {payMethod === 'card' && (
                  <div className="pay-fields" id="cardFields">
                    <div className="field">
                      <label className="lab" htmlFor="co-card">
                        Card Number
                      </label>
                      <input id="co-card" className="inp" placeholder="0000 0000 0000 0000" />
                    </div>
                    <div className="grid2">
                      <div className="field">
                        <label className="lab" htmlFor="co-exp">
                          Expiry
                        </label>
                        <input id="co-exp" className="inp" placeholder="MM / YY" />
                      </div>
                      <div className="field">
                        <label className="lab" htmlFor="co-cvv">
                          CVV
                        </label>
                        <input id="co-cvv" className="inp" placeholder="•••" />
                      </div>
                    </div>
                    <div className="field">
                      <label className="lab" htmlFor="co-name">
                        Name on Card
                      </label>
                      <input id="co-name" className="inp" placeholder="Full name" />
                    </div>
                  </div>
                )}
                <div
                  className={`opt-row${payMethod === 'upi' ? ' sel' : ''}`}
                  onClick={() => {
                    setPayMethod('upi');
                    track('checkout_step', { props: { step: 'method_selected', method: 'upi' } });
                  }}
                >
                  <span className="radio"></span>
                  <div className="ot">
                    <div className="t">UPI</div>
                    <div className="d">Google Pay · PhonePe · Paytm</div>
                  </div>
                </div>
                <div
                  className={`opt-row${payMethod === 'cod' ? ' sel' : ''}`}
                  onClick={() => {
                    setPayMethod('cod');
                    track('checkout_step', { props: { step: 'method_selected', method: 'cod' } });
                  }}
                >
                  <span className="radio"></span>
                  <div className="ot">
                    <div className="t">Cash on Delivery</div>
                    <div className="d">Available on standard sizes only</div>
                  </div>
                </div>
              </div>

              <button className="btn-buy gold place" type="submit" disabled={busy || paymentsUnavailable}>
                {busy ? 'Placing Order…' : `Place Order · ${formatINR(total)}`}
              </button>
              <p className="legal">
                By placing your order you agree to our <a href="#">Terms</a> and{' '}
                <a href="#">Made-to-Order Policy</a>.
              </p>
            </form>
          )}
        </section>

        {/* SUMMARY */}
        <aside className="co-summary">
          <div className="sticky">
            <h2>Order Summary</h2>

            {items.map((i) => (
              <div className="ci" key={cartLineKey(i)}>
                <ImageSlot src={i.imageUrl} label={i.name} alt={i.name} />
                <div>
                  <div className="cn">{i.name}</div>
                  <div className="ca">
                    {i.color} · Size {i.size} · Qty {i.qty}
                    {i.includedComponents.length > 0 &&
                      ` · With ${i.includedComponents.join(' & ')}`}
                    {i.customColor && ' · Custom colour'}
                  </div>
                  {i.measurements && <div className="line-note">{i.measurements}</div>}
                </div>
                <div className="cp">{formatINR(i.unitPrice * i.qty)}</div>
              </div>
            ))}

            <div style={{ height: '1.2rem' }}></div>
            <div className="srow">
              <span>Subtotal</span>
              <span>{formatINR(subtotal)}</span>
            </div>
            <div className="srow muted">
              <span>Shipping</span>
              {deliveryFee === 0 ? (
                <span className="free">Complimentary</span>
              ) : (
                <span>{formatINR(deliveryFee)}</span>
              )}
            </div>
            <div className="srow muted">
              <span>Duties &amp; Taxes</span>
              <span>Included</span>
            </div>
            <div className="sdiv"></div>
            <div className="co-total">
              <span className="l">Total</span>
              <span className="v">{formatINR(total)}</span>
            </div>

            <div className="note">
              <span className="dot"></span>
              <span>
                Each piece is made to order. Our atelier will confirm your measurements within 48
                hours of purchase.
              </span>
            </div>
          </div>
        </aside>
      </main>

      <RazorpayMock
        open={payment !== null}
        amount={payment?.amount ?? total}
        orderNumber={order?.orderNumber}
        keyId={payment?.keyId}
        busy={busy}
        onPay={() => void onPay()}
        onFail={() => void onFail()}
        onClose={() => setPayment(null)}
      />
    </div>
  );
}
