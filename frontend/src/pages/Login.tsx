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

// Brand marks, following the inline-SVG convention in Contact.tsx. Apple's is
// the monochrome simple-icons path and inherits currentColor; Google's official
// "G" is four-colour and keeps its own fills — Google's branding rules don't
// allow it to be recoloured. Both are aria-hidden so the button's accessible
// name stays the visible word beside them.
const MARK_STYLE = { verticalAlign: '-0.14em', marginRight: '0.4em', flex: 'none' } as const;

const APPLE_PATH =
  'M12.152 6.896c-.948 0-2.415-1.078-3.96-1.04-2.04.027-3.91 1.183-4.961 3.014-2.117 3.675-.546 9.103 1.519 12.09 1.013 1.454 2.208 3.09 3.792 3.039 1.52-.065 2.09-.987 3.935-.987 1.831 0 2.35.987 3.96.948 1.637-.026 2.676-1.48 3.676-2.948 1.156-1.688 1.636-3.325 1.662-3.415-.039-.013-3.182-1.221-3.22-4.857-.026-3.04 2.48-4.494 2.597-4.559-1.429-2.09-3.623-2.324-4.39-2.376-2-.156-3.675 1.09-4.61 1.09zM15.53 3.83c.843-1.012 1.4-2.427 1.245-3.83-1.207.052-2.662.805-3.532 1.818-.78.896-1.454 2.338-1.273 3.714 1.338.104 2.715-.688 3.559-1.701';

function AppleMark() {
  return (
    <svg
      viewBox="0 0 24 24"
      width="1em"
      height="1em"
      fill="currentColor"
      aria-hidden="true"
      style={MARK_STYLE}
    >
      <path d={APPLE_PATH} />
    </svg>
  );
}

function GoogleMark() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true" style={MARK_STYLE}>
      <path
        fill="#4285F4"
        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z"
      />
      <path
        fill="#34A853"
        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
      />
      <path
        fill="#FBBC05"
        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
      />
      <path
        fill="#EA4335"
        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
      />
    </svg>
  );
}

export default function Login() {
  const { login, loginWithGoogle, requestOtp, verifyOtp, register } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const googleClientId = (import.meta.env.VITE_GOOGLE_CLIENT_ID as string | undefined) || undefined;
  const googleSlotRef = useRef<HTMLDivElement | null>(null);

  const [tab, setTab] = useState<'signin' | 'phone' | 'register'>('signin');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [regPassword, setRegPassword] = useState('');
  const [phone, setPhone] = useState('');
  const [otpPhone, setOtpPhone] = useState<string | null>(null); // normalized number a code was sent to
  const [otpCode, setOtpCode] = useState('');

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

  const onSendCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      const { phone: normalized } = await requestOtp(phone);
      setOtpPhone(normalized);
      setOtpCode('');
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Unable to send the code.');
    } finally {
      setBusy(false);
    }
  };

  const onVerifyCode = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await verifyOtp(otpPhone ?? phone, otpCode);
      navigate('/account');
    } catch (err) {
      setError((err as { message?: string }).message ?? 'Unable to verify the code.');
    } finally {
      setBusy(false);
    }
  };

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
              className={`auth-tab${tab === 'phone' ? ' on' : ''}`}
              onClick={() => {
                setTab('phone');
                setError(null);
              }}
            >
              Phone
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

          <form
            className={`auth-panel${tab === 'phone' ? ' on' : ''}`}
            onSubmit={otpPhone ? onVerifyCode : onSendCode}
          >
            <h1>Sign in with your phone</h1>
            <p className="lead">
              {otpPhone
                ? `Enter the 6-digit code sent to ${otpPhone}.`
                : 'We’ll text you a one-time code — no password needed.'}
            </p>
            {tab === 'phone' && error && <p className="auth-err">{error}</p>}
            {!otpPhone ? (
              <div className="field">
                <label className="lab" htmlFor="ph-number">
                  Mobile Number
                </label>
                <input
                  id="ph-number"
                  className="inp"
                  type="tel"
                  autoComplete="tel"
                  placeholder="+91 90000 00000"
                  required
                  value={phone}
                  onChange={(e) => setPhone(e.target.value)}
                />
              </div>
            ) : (
              <div className="field">
                <label className="lab" htmlFor="ph-code">
                  One-Time Code
                </label>
                <input
                  id="ph-code"
                  className="inp"
                  type="text"
                  inputMode="numeric"
                  autoComplete="one-time-code"
                  pattern="\d{6}"
                  maxLength={6}
                  placeholder="••••••"
                  required
                  value={otpCode}
                  onChange={(e) => setOtpCode(e.target.value.replace(/\D/g, ''))}
                />
              </div>
            )}
            <button className="btn-buy" type="submit" disabled={busy}>
              {otpPhone
                ? busy
                  ? 'Verifying…'
                  : 'Verify & Sign In'
                : busy
                  ? 'Sending Code…'
                  : 'Send Code'}
            </button>
            {otpPhone && (
              <div className="auth-row" style={{ marginTop: '0.8rem' }}>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    setOtpPhone(null);
                    setOtpCode('');
                    setError(null);
                  }}
                >
                  Use a different number
                </a>
                <a
                  href="#"
                  onClick={(e) => {
                    e.preventDefault();
                    if (!busy) void onSendCode(e);
                  }}
                >
                  Resend code
                </a>
              </div>
            )}
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
                <GoogleMark />
                Google
              </button>
            )}
            <button type="button" onClick={() => showToast('Apple sign-in — coming soon')}>
              <AppleMark />
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
