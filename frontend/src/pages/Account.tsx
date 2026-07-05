import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import type { Order, OrderStatus } from '../lib/types';
import { useAuth } from '../lib/auth';
import { useWishlist } from '../lib/wishlist';
import { formatINR } from '../lib/format';
import Shop from '../components/Shop';
import ImageSlot from '../components/ImageSlot';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/account.css';

const BADGES: Record<OrderStatus, { cls: string; label: string }> = {
  pending_payment: { cls: 'crafting', label: 'Pending Payment' },
  paid: { cls: 'crafting', label: 'In the Atelier' },
  in_atelier: { cls: 'crafting', label: 'In the Atelier' },
  quality_check: { cls: 'crafting', label: 'Quality Check' },
  dispatched: { cls: 'delivered', label: 'Dispatched' },
  delivered: { cls: 'delivered', label: 'Delivered' },
  cancelled: { cls: 'crafting', label: 'Cancelled' },
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' });
}

export default function Account() {
  const { token, user, logout } = useAuth();
  const wishlist = useWishlist();
  const navigate = useNavigate();
  const [orders, setOrders] = useState<Order[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!token) {
      navigate('/login', { replace: true });
      return;
    }
    let cancelled = false;
    api
      .get<Order[] | { items: Order[] }>('/api/me/orders')
      .then((d) => {
        if (!cancelled) setOrders(Array.isArray(d) ? d : d.items);
      })
      .catch((e: { message?: string }) => {
        if (!cancelled) setError(e.message ?? 'Unable to load your orders right now.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, navigate]);

  if (!token || !user) return null;

  const latest = orders[0];

  return (
    <Shop page="page-account">
      <div className="page-hero">
        <span className="eyebrow">My Account</span>
        <h1>Welcome back, {user.firstName}</h1>
      </div>

      <main className="acct">
        <aside className="acct-side">
          <div className="who">
            <div className="hi">Signed in as</div>
            <div className="nm">
              {user.firstName} {user.lastName}
            </div>
          </div>
          <nav className="acct-nav">
            <a className="on" href="#orders">
              Orders <span>{orders.length}</span>
            </a>
            <Link to="/wishlist">
              Wishlist <span>{wishlist.count}</span>
            </Link>
            <a href="#addresses">Addresses</a>
            <a href="#addresses">Profile &amp; Details</a>
            <div className="sep"></div>
            <Link to="/contact">Book Appointment</Link>
            <Link to="/client-care">Client Care</Link>
            <a
              className="signout"
              href="#"
              onClick={(e) => {
                e.preventDefault();
                logout();
                navigate('/');
              }}
            >
              Sign Out
            </a>
          </nav>
        </aside>

        <section>
          {/* orders */}
          <div className="panel" id="orders" style={{ marginBottom: '3rem' }}>
            <h2>Your Orders</h2>
            <p className="sub">Track your commissions through the atelier.</p>

            {loading && <p className="api-note">Fetching your commissions…</p>}
            {error && <p className="api-note err">{error}</p>}
            {!loading && !error && orders.length === 0 && (
              <p className="api-note">No orders yet — your first commission awaits.</p>
            )}

            {orders.map((o) => {
              const badge = BADGES[o.status];
              const pieces = o.items.reduce((n, it) => n + it.quantity, 0);
              const first = o.items[0];
              return (
                <div className="order" key={o.id}>
                  <div className="order-top">
                    <div className="meta">
                      <div>
                        <div className="k">Order</div>
                        <div className="v">{o.orderNumber}</div>
                      </div>
                      <div>
                        <div className="k">Placed</div>
                        <div className="v">{fmtDate(o.createdAt)}</div>
                      </div>
                      <div>
                        <div className="k">Total</div>
                        <div className="v">{formatINR(o.total)}</div>
                      </div>
                    </div>
                    <span className={`badge ${badge.cls}`}>{badge.label}</span>
                  </div>
                  <div className="order-body">
                    <ImageSlot
                      src={first?.imageUrl ?? null}
                      label="Order"
                      alt={first?.productName ?? 'Order'}
                    />
                    <div className="items">
                      <div className="nm">
                        {first?.productName}
                        {o.items.length > 1 && <> &nbsp;+{o.items.length - 1}</>}
                      </div>
                      <div className="x">
                        {pieces} {pieces === 1 ? 'piece' : 'pieces'} ·{' '}
                        {o.status === 'delivered'
                          ? `delivered ${fmtDate(o.createdAt)}`
                          : 'est. dispatch 4–6 weeks'}
                      </div>
                    </div>
                    <div className="tot">
                      <div className="v">{formatINR(o.total)}</div>
                      <Link to={`/order/${o.orderNumber}?email=${encodeURIComponent(o.email)}`}>
                        {o.status === 'delivered' ? 'Buy Again' : 'Track Order'}
                      </Link>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>

          {/* addresses */}
          <div className="panel" id="addresses">
            <h2>Addresses</h2>
            <p className="sub">Where we send your finished pieces.</p>
            <div className="addr-grid">
              {latest ? (
                <div className="addr default">
                  <div className="tag">Default · Shipping</div>
                  <p>
                    {latest.firstName} {latest.lastName}
                    <br />
                    {latest.addressLine1}
                    {latest.addressLine2 ? (
                      <>
                        <br />
                        {latest.addressLine2}
                      </>
                    ) : null}
                    <br />
                    {latest.city}, {latest.state} {latest.pincode}
                    <br />
                    {latest.phone}
                  </p>
                  <span className="edit">Edit</span>
                </div>
              ) : (
                <div className="addr">
                  <div className="tag">Shipping</div>
                  <p>Your address appears here after your first order.</p>
                </div>
              )}
              <div className="addr add">
                <div>
                  <div className="plus">+</div>Add New Address
                </div>
              </div>
            </div>
          </div>
        </section>
      </main>
      <Reveal watch={orders.length} />
      <Ambient watch={orders.length} />
    </Shop>
  );
}
