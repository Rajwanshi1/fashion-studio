import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { cartLineKey, useCart } from '../lib/cart';
import { formatINR } from '../lib/format';
import ImageSlot from './ImageSlot';

interface CartDrawerContextValue {
  open: boolean;
  openDrawer: () => void;
  closeDrawer: () => void;
}

const CartDrawerContext = createContext<CartDrawerContextValue | null>(null);

function DrawerUI({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { items, remove, subtotal } = useCart();
  const navigate = useNavigate();

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

  return (
    <>
      <div className={`cd-backdrop${open ? ' open' : ''}`} onClick={onClose} />
      <aside className={`cd-drawer${open ? ' open' : ''}`} aria-label="Shopping bag" aria-hidden={!open}>
        <div className="cd-head">
          <h3>Your Bag</h3>
          <button className="x" aria-label="Close" onClick={onClose}>
            ✕
          </button>
        </div>
        <div className="cd-note">Complimentary shipping · Made to order</div>
        <div className="cd-items">
          {items.length === 0 && <p className="cd-empty">Your bag is empty.</p>}
          {items.map((i) => (
            <div className="cd-item" key={cartLineKey(i)}>
              <ImageSlot src={i.imageUrl} label={i.name} alt={i.name} />
              <div>
                <div className="nm">{i.name}</div>
                <div className="at">
                  {i.color} · Size {i.size} · Qty {i.qty}
                  {i.includedComponents.length > 0 &&
                    ` · With ${i.includedComponents.join(' & ')}`}
                  {i.customColor && ' · Custom colour'}
                </div>
                {i.measurements && <div className="line-note">{i.measurements}</div>}
                <button className="rm" onClick={() => remove(cartLineKey(i))}>
                  Remove
                </button>
              </div>
              <div className="pr">{formatINR(i.unitPrice * i.qty)}</div>
            </div>
          ))}
        </div>
        <div className="cd-foot">
          <div className="cd-sub">
            <span className="l">Subtotal</span>
            <span className="v cd-subval">{formatINR(subtotal)}</span>
          </div>
          <div className="cd-ship">Shipping &amp; duties calculated at checkout</div>
          <div className="cd-actions">
            <button
              className="btn-buy gold"
              onClick={() => {
                onClose();
                navigate('/checkout');
              }}
            >
              Checkout
            </button>
            <Link className="btn-outline" to="/cart" onClick={onClose}>
              View Full Bag
            </Link>
          </div>
        </div>
      </aside>
    </>
  );
}

export function CartDrawerProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const openDrawer = useCallback(() => setOpen(true), []);
  const closeDrawer = useCallback(() => setOpen(false), []);
  const value = useMemo(() => ({ open, openDrawer, closeDrawer }), [open, openDrawer, closeDrawer]);

  return (
    <CartDrawerContext.Provider value={value}>
      {children}
      <DrawerUI open={open} onClose={closeDrawer} />
    </CartDrawerContext.Provider>
  );
}

export function useCartDrawer(): CartDrawerContextValue {
  const ctx = useContext(CartDrawerContext);
  if (!ctx) throw new Error('useCartDrawer must be used within CartDrawerProvider');
  return ctx;
}
