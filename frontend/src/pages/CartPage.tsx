import { Link, useNavigate } from 'react-router-dom';
import { cartLineKey, useCart } from '../lib/cart';
import { formatINR } from '../lib/format';
import Shop from '../components/Shop';
import ImageSlot from '../components/ImageSlot';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/cart.css';
import { usePageTitle } from '../lib/usePageTitle';

export default function CartPage() {
  usePageTitle('Your Bag');
  const { items, setQty, remove, subtotal, count } = useCart();
  const navigate = useNavigate();

  return (
    <Shop page="page-cart">
      <main className="cart-wrap">
        <section>
          <div className="cart-head">
            <h1>Your Bag</h1>
            <span className="n">
              {count} {count === 1 ? 'Piece' : 'Pieces'}
            </span>
          </div>

          {items.length === 0 && (
            <p className="api-note">
              Your bag is empty — the atelier awaits your first commission.
            </p>
          )}

          {items.map((i) => (
            <article className="line" key={cartLineKey(i)}>
              <ImageSlot src={i.imageUrl} label={i.name} alt={i.name} sizes="96px" />
              <div>
                <div className="nm">
                  <Link to={`/product/${i.productSlug}`}>{i.name}</Link>
                </div>
                <div className="attrs">
                  <span>Colour — {i.color}</span>
                  <span>Size — {i.size}</span>
                  {i.includedComponents.length > 0 && (
                    <span>
                      Includes {i.includedComponents.join(' · ')}
                    </span>
                  )}
                  <span className="tag">Made to Order · 4–6 weeks</span>
                </div>
                {i.measurements && <div className="line-note">{i.measurements}</div>}
                <div className="controls">
                  <div className="qty">
                    <button
                      type="button"
                      aria-label="Decrease quantity"
                      onClick={() => setQty(cartLineKey(i), Math.max(1, i.qty - 1))}
                    >
                      −
                    </button>
                    <span className="val">{i.qty}</span>
                    <button
                      type="button"
                      aria-label="Increase quantity"
                      onClick={() => setQty(cartLineKey(i), i.qty + 1)}
                    >
                      +
                    </button>
                  </div>
                  <button className="rm" onClick={() => remove(cartLineKey(i))}>
                    Remove
                  </button>
                </div>
              </div>
              <div className="price-col">{formatINR(i.unitPrice * i.qty)}</div>
            </article>
          ))}

          <div className="cart-foot">
            <Link to="/">← Continue Shopping</Link>
          </div>
        </section>

        {/* summary */}
        <aside className="summary">
          <h2>Order Summary</h2>
          <div className="sline">
            <span>Subtotal</span>
            <span>{formatINR(subtotal)}</span>
          </div>
          <div className="sline muted">
            <span>Shipping</span>
            <span className="free">Complimentary</span>
          </div>
          <div className="sline muted">
            <span>Estimated Duties</span>
            <span>Calculated at checkout</span>
          </div>

          <div className="promo">
            <input type="text" placeholder="Gift card or promo code" />
            <button type="button">Apply</button>
          </div>

          <div className="sdiv"></div>
          <div className="stotal">
            <span className="l">Total</span>
            <span className="v">{formatINR(subtotal)}</span>
          </div>
          <div className="vat">Inclusive of all taxes</div>

          <button
            className="btn-buy"
            disabled={items.length === 0}
            onClick={() => navigate('/checkout')}
          >
            Proceed to Checkout
          </button>

          <div className="reassure">
            <span className="dot"></span>
            <span>
              Each piece is crafted to order. Our atelier confirms your measurements within 48
              hours of purchase.
            </span>
          </div>
        </aside>
      </main>
      <Reveal watch={items.length} />
      <Ambient watch={items.length} />
    </Shop>
  );
}
