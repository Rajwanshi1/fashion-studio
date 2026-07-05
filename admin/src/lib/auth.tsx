import { createContext, useCallback, useContext, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { api, AUTH_STORAGE_KEY } from './api';
import type { PublicUser } from './types';

interface AuthState {
  token: string;
  user: PublicUser;
}

interface AuthContextValue {
  token: string | null;
  user: PublicUser | null;
  login: (email: string, password: string) => Promise<void>;
  logout: () => void;
}

const AuthContext = createContext<AuthContextValue | null>(null);

export const STAFF_ONLY_MESSAGE = 'This portal is for atelier staff';

function loadStored(): AuthState | null {
  try {
    const raw = localStorage.getItem(AUTH_STORAGE_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<AuthState>;
    if (typeof parsed.token === 'string' && parsed.user && parsed.user.role === 'admin') {
      return parsed as AuthState;
    }
    return null;
  } catch {
    return null;
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [auth, setAuth] = useState<AuthState | null>(loadStored);

  const login = useCallback(async (email: string, password: string) => {
    const data = await api<AuthState>('/api/auth/login', {
      method: 'POST',
      body: { email, password },
    });
    if (data.user.role !== 'admin') {
      throw new Error(STAFF_ONLY_MESSAGE);
    }
    localStorage.setItem(AUTH_STORAGE_KEY, JSON.stringify(data));
    setAuth(data);
  }, []);

  const logout = useCallback(() => {
    localStorage.removeItem(AUTH_STORAGE_KEY);
    setAuth(null);
  }, []);

  const value = useMemo<AuthContextValue>(
    () => ({ token: auth?.token ?? null, user: auth?.user ?? null, login, logout }),
    [auth, login, logout],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
