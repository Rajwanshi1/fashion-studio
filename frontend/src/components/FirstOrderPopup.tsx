import { useCallback, useEffect, useState, type ReactNode } from 'react';
import { Link, useLocation } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useFirstOrderOffer } from '../lib/offers';

const SEEN_KEY = 'ta.offer-seen';

function seen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return true; // storage unavailable — never nag
  }
}

function markSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    /* storage unavailable */
  }
}

function PopupUI({ onDismiss }: { onDismiss: () => void }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onDismiss();
    };
    document.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [onDismiss]);

  return (
    <>
      <div className="fo-backdrop" onClick={onDismiss} />
      <div className="fo-popup" role="dialog" aria-modal="true" aria-label="First order offer">
        <span className="eyebrow">From the atelier</span>
        <h3>Your first order — 5% off</h3>
        <p>…with complimentary shipping. Sign in and it's applied automatically at checkout.</p>
        <div className="fo-actions">
          <Link className="btn-buy gold" to="/login" onClick={onDismiss}>
            Sign in
          </Link>
          <button className="fo-later" onClick={onDismiss}>
            Maybe later
          </button>
        </div>
      </div>
    </>
  );
}

/** Renders children plus the one-time offer pop-up (CartDrawerProvider pattern). */
export function FirstOrderPopupProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const { pathname } = useLocation();
  const { user } = useAuth();
  const offer = useFirstOrderOffer();

  useEffect(() => {
    if (seen()) return;
    const timer = setTimeout(() => setOpen(true), 2000);
    return () => clearTimeout(timer);
  }, []);

  const dismiss = useCallback(() => {
    markSeen();
    setOpen(false);
  }, []);

  // Checkout stays uncluttered, and a signed-in shopper who already ordered
  // has nothing left to sign in for.
  const suppressed = pathname === '/checkout' || (!!user && offer?.eligible === false);

  return (
    <>
      {children}
      {open && !suppressed && <PopupUI onDismiss={dismiss} />}
    </>
  );
}
