import { useState, type FormEvent } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toast';
import ImageSlot from '../components/ImageSlot';
import Reveal from '../components/Reveal';
import '../styles/auth.css';

export default function Login() {
  const { login, register } = useAuth();
  const { showToast } = useToast();
  const navigate = useNavigate();

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
            <button type="button" onClick={() => showToast('Google sign-in — coming soon')}>
              Google
            </button>
            <button type="button" onClick={() => showToast('Apple sign-in — coming soon')}>
              Apple
            </button>
          </div>
          <p className="soon">Social sign-in — coming soon</p>
          <div className="back-home">
            <Link to="/">← Back to Tanvi Agnihotry</Link>
          </div>
        </div>
      </main>
      <Reveal />
    </div>
  );
}
