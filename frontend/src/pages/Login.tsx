import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import ImageSlot from '../components/ImageSlot';
import Reveal from '../components/Reveal';
import '../styles/auth.css';

// Minimal Google Identity Services surface — we deliberately avoid the
// @types/google.accounts dependency and declare only what we call.
interface GoogleCredentialResponse {
  credential: string;
}

interface GoogleIdConfiguration {
  client_id: string;
  callback: (response: GoogleCredentialResponse) => void;
}

interface GsiButtonConfiguration {
  type?: 'standard' | 'icon';
  theme?: 'outline' | 'filled_blue' | 'filled_black';
  size?: 'large' | 'medium' | 'small';
  text?: 'signin_with' | 'signup_with' | 'continue_with' | 'signin';
  width?: number;
  logo_alignment?: 'left' | 'center';
}

declare global {
  interface Window {
    google?: {
      accounts: {
        id: {
          initialize: (config: GoogleIdConfiguration) => void;
          renderButton: (parent: HTMLElement, options: GsiButtonConfiguration) => void;
        };
      };
    };
  }
}

const GSI_SRC = 'https://accounts.google.com/gsi/client';

export default function Login() {
  const { login, loginWithGoogle, register } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || undefined;
  const googleSlotRef = useRef<HTMLDivElement | null>(null);

  const [tab, setTab] = useState<'signin' | 'register'>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');

  const onSignIn = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(email, password);
      navigate('/account');
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Unable to sign in.');
    } finally {
      setBusy(false);
    }
  };

  useEffect(() => {
    if (!googleClientId) return;
    let cancelled = false;

    const init = () => {
      const gsi = window.google?.accounts.id;
      const slot = googleSlotRef.current;
      if (cancelled || !gsi || !slot) return;
      gsi.initialize({
        client_id: googleClientId,
        callback: (response) => {
          void (async () => {
            setBusy(true);
            setError(null);
            try {
              await loginWithGoogle(response.credential);
              navigate('/account');
            } catch (err) {
              setError((err as { message?: string }).message ?? 'Unable to sign in with Google.');
            } finally {
              setBusy(false);
            }
          })();
        },
      });
      gsi.renderButton(slot, { theme: 'outline', size: 'large', text: 'continue_with' });
    };

    if (window.google?.accounts.id) {
      init();
      return;
    }

    const existing = document.querySelector<HTMLScriptElement>(`script[src="${GSI_SRC}"]`);
    const script = existing ?? document.createElement('script');
    if (!existing) {
      script.src = GSI_SRC;
      script.async = true;
      script.defer = true;
      document.head.appendChild(script);
    }
    script.addEventListener('load', init);
    return () => {
      cancelled = true;
      script.removeEventListener('load', init);
    };
  }, [googleClientId, loginWithGoogle, navigate]);

  const onRegister = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await register(firstName, lastName, regEmail, regPassword);
      navigate('/account');
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Unable to create your account.');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page-auth">
      <main className="auth">
        <div className="auth-art">
          <ImageSlot label="Editorial portrait — full bleed" />
          <div className="cap">
            <span className="eyebrow">The Verdant Edit</span>
            <h2>Your atelier, remembered.</h2>
          </div>
        </div>

        <div className="auth-form">
          <div className="brand">Tanvi Agnihotry</div>
          <div className="auth-tabs">
            <button
              className={`auth-tab${tab === 'signin' ? ' on' : ''}`}
              onClick={() => {
                setTab('signin');
                setError(null);
              }}
            >
              Sign In
            </button>
            <button
              className={`auth-tab${tab === 'register' ? ' on' : ''}`}
              onClick={() => {
                setTab('register');
                setError(null);
              }}
            >
              Create Account
            </button>
          </div>

          <form className={`auth-panel${tab === 'signin' ? ' on' : ''}`} onSubmit={onSignIn}>
            <h1>Welcome back</h1>
            <p className="lead">Sign in to track commissions and your saved pieces.</p>
            {tab === 'signin' && error && <p className="auth-err">{error}</p>}
            <div className="field">
              <label className="lab" htmlFor="li-email">
                Email
              </label>
              <input
                id="li-email"
                className="inp"
                type="email"
                placeholder="you@example.com"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="lab" htmlFor="li-pass">
                Password
              </label>
              <input
                id="li-pass"
                className="inp"
                type="password"
                placeholder="••••••••"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            <div className="auth-row">
              <label className="check">
                <input type="checkbox" /> Remember me
              </label>
              <a href="#" onClick={(e) => e.preventDefault()}>
                Forgot password?
              </a>
            </div>
            <button className="btn-buy" type="submit" disabled={busy}>
              {busy ? 'Signing In…' : 'Sign In'}
            </button>
          </form>

          <form className={`auth-panel${tab === 'register' ? ' on' : ''}`} onSubmit={onRegister}>
            <h1>Join the house</h1>
            <p className="lead">
              Create an account for private previews and made-to-order openings.
            </p>
            {tab === 'register' && error && <p className="auth-err">{error}</p>}
            <div className="grid2">
              <div className="field">
                <label className="lab" htmlFor="rg-first">
                  First Name
                </label>
                <input
                  id="rg-first"
                  className="inp"
                  placeholder="First name"
                  required
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                />
              </div>
              <div className="field">
                <label className="lab" htmlFor="rg-last">
                  Last Name
                </label>
                <input
                  id="rg-last"
                  className="inp"
                  placeholder="Last name"
                  required
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                />
              </div>
            </div>
            <div className="field">
              <label className="lab" htmlFor="rg-email">
                Email
              </label>
              <input
                id="rg-email"
                className="inp"
                type="email"
                placeholder="you@example.com"
                required
                value={regEmail}
                onChange={(e) => setRegEmail(e.target.value)}
              />
            </div>
            <div className="field">
              <label className="lab" htmlFor="rg-pass">
                Password
              </label>
              <input
                id="rg-pass"
                className="inp"
                type="password"
                placeholder="Create a password"
                required
                value={regPassword}
                onChange={(e) => setRegPassword(e.target.value)}
              />
            </div>
            <label className="check" style={{ margin: '0.4rem 0 1.4rem' }}>
              <input type="checkbox" defaultChecked /> Keep me updated on new collections
            </label>
            <button className="btn-buy" type="submit" disabled={busy}>
              {busy ? 'Creating Account…' : 'Create Account'}
            </button>
          </form>

          <div className="auth-or">or continue with</div>
          <div className="social-row">
            {googleClientId ? (
              <div className="google-slot" ref={googleSlotRef} aria-label="Sign in with Google" />
            ) : (
              <button type="button" onClick={() => showToast('Google sign-in — setup pending')}>
                Google
              </button>
            )}
            <button type="button" onClick={() => showToast('Apple sign-in — coming soon')}>
              Apple
            </button>
          </div>
          <p className="soon">
            {googleClientId ? 'Apple sign-in — coming soon' : 'Social sign-in — coming soon'}
          </p>
          <div className="back-home">
            <Link to="/">← Back to Tanvi Agnihotry</Link>
          </div>
        </div>
      </main>
      <Reveal />
    </div>
  );
}
