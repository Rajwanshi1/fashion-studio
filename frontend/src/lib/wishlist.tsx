import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
import { api } from './api';
import { useAuth } from './auth';
import { track } from './analytics';

const STORAGE_KEY = 'ta.wishlist';

interface WishlistContextValue {
  ids: string[];
  has: (productId: string) => boolean;
  toggle: (productId: string) => void;
  remove: (productId: string) => void;
  count: number;
}

const WishlistContext = createContext<WishlistContextValue | null>(null);

function loadLocal(): string[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string') : [];
  } catch {
    return [];
  }
}

/** Server may return product ids or product objects — normalise to ids. */
function normaliseServer(data: unknown): string[] {
  const arr = Array.isArray(data)
    ? data
    : data && Array.isArray((data as { items?: unknown[] }).items)
      ? (data as { items: unknown[] }).items
      : [];
  return arr
    .map((x) =>
      typeof x === 'string'
        ? x
        : x && typeof x === 'object'
          ? ((x as { productId?: string; id?: string }).productId ??
            (x as { id?: string }).id ??
            '')
          : '',
    )
    .filter(Boolean);
}

export function WishlistProvider({ children }: { children: ReactNode }) {
  const { token } = useAuth();
  const [ids, setIds] = useState<string[]>(loadLocal);

  // Guest persistence
  useEffect(() => {
    if (token) return;
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(ids));
    } catch {
      /* storage unavailable */
    }
  }, [ids, token]);

  // Logged in: pull server list, merge any guest saves up to the server.
  useEffect(() => {
    if (!token) {
      setIds(loadLocal());
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const server = normaliseServer(await api.get<unknown>('/api/me/wishlist'));
        const local = loadLocal();
        const missing = local.filter((id) => !server.includes(id));
        await Promise.all(
          missing.map((id) => api.put(`/api/me/wishlist/${id}`).catch(() => undefined)),
        );
        if (!cancelled) setIds([...server, ...missing]);
      } catch {
        if (!cancelled) setIds(loadLocal());
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [token]);

  const has = useCallback((productId: string) => ids.includes(productId), [ids]);

  const remove = useCallback(
    (productId: string) => {
      track('wishlist_remove', { productId });
      setIds((prev) => prev.filter((id) => id !== productId));
      if (token) api.del(`/api/me/wishlist/${productId}`).catch(() => undefined);
    },
    [token],
  );

  const toggle = useCallback(
    (productId: string) => {
      // `exists` is read from `ids` here — not recomputed inside the setIds
      // updater — so track() (and the api call) run exactly once per click.
      // React 18 StrictMode double-invokes functional updaters passed to
      // setState; the api.del/put calls already tolerate that (idempotent),
      // but a countable analytics event must not double-fire.
      const exists = ids.includes(productId);
      track(exists ? 'wishlist_remove' : 'wishlist_add', { productId });
      if (token) {
        (exists
          ? api.del(`/api/me/wishlist/${productId}`)
          : api.put(`/api/me/wishlist/${productId}`)
        ).catch(() => undefined);
      }
      setIds((prev) => (exists ? prev.filter((id) => id !== productId) : [...prev, productId]));
    },
    [ids, token],
  );

  const value = useMemo(
    () => ({ ids, has, toggle, remove, count: ids.length }),
    [ids, has, toggle, remove],
  );

  return <WishlistContext.Provider value={value}>{children}</WishlistContext.Provider>;
}

export function useWishlist(): WishlistContextValue {
  const ctx = useContext(WishlistContext);
  if (!ctx) throw new Error('useWishlist must be used within WishlistProvider');
  return ctx;
}
