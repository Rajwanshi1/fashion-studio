import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import { track } from './analytics';
import type { AuthResponse, PublicUser } from './types';

const STORAGE_KEY = 'ta.auth';

interface AuthContextValue {
  token: string | null;
  user: PublicUser | null;
  login: (email: string, password: string) => Promise<void>;
  loginWithGoogle: (credential: string) => Promise<void>;
  register: (
    firstName: string,
    lastName: string,
    email: string,
    password: string,
  ) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function load(): { token: string | null; user: PublicUser | null } {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return { token: null, user: null };
    const parsed = JSON.parse(raw) as { token?: string; user?: PublicUser };
    return { token: parsed.token ?? null, user: parsed.user ?? null };
  } catch {
    return { token: null, user: null };
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState(load);

  const persist = (token: string | null, user: PublicUser | null) => {
    setState({ token, user });
    try {
      if (token) localStorage.setItem(STORAGE_KEY, JSON.stringify({ token, user }));
      else localStorage.removeItem(STORAGE_KEY);
    } catch {
      /* storage unavailable */
    }
  };

  const login = useCallback(async (email: string, password: string) => {
    const res = await api.post<AuthResponse>('/api/auth/login', { email, password });
    persist(res.token, res.user);
    track('login', { props: { method: 'password' } });
  }, []);

  const loginWithGoogle = useCallback(async (credential: string) => {
    const res = await api.post<AuthResponse>('/api/auth/google', { credential });
    persist(res.token, res.user);
    track('login', { props: { method: 'google' } });
  }, []);

  const register = useCallback(
    async (firstName: string, lastName: string, email: string, password: string) => {
      const res = await api.post<AuthResponse>('/api/auth/register', {
        firstName,
        lastName,
        email,
        password,
      });
      persist(res.token, res.user);
      track('signup', { props: { method: 'password' } });
    },
    [],
  );

  const logout = useCallback(() => persist(null, null), []);

  const value = useMemo(
    () => ({ token: state.token, user: state.user, login, loginWithGoogle, register, logout }),
    [state, login, loginWithGoogle, register, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
