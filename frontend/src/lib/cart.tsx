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
import { track } from './analytics';

const STORAGE_KEY = 'ta.cart';

export interface CartItem {
  variantId: string;
  productId: string;
  productSlug: string;
  name: string;
  size: string;
  color: string;
  /** Final per-unit price: base garment + the add-ons kept in this line. */
  unitPrice: number;
  qty: number;
  imageUrl: string | null;
  /** Names of the kept optional add-ons, for line summaries ("With Dupatta"). */
  includedComponents: string[];
  /** Names of the optional components the shopper unticked — sent to the API
   *  and part of line identity (see cartLineKey). */
  excludedComponents: string[];
  /** Free-text note for made-to-measure lines; '' otherwise. Part of line
   *  identity — the same variant with a different note is a separate line. */
  measurements: string;
  /** Epoch ms when the line was added; lines expire after CART_TTL_MS. */
  addedAt: number;
}

/** A bag is a session artefact, not an archive — stale lines with dead
 *  prices/products mislead more than they help. */
const CART_TTL_MS = 30 * 24 * 60 * 60 * 1000;

/** Line identity: variant + set selection + measurements + the price the line
 *  was added at — two adds of the same selection only merge when they showed
 *  the same price (checkout guarantees each line is charged exactly its own
 *  snapshotted unitPrice). */
export function cartLineKey(
  i: Pick<CartItem, 'variantId' | 'excludedComponents' | 'measurements' | 'unitPrice'>,
): string {
  return `${i.variantId}:${[...i.excludedComponents].sort().join(',')}:${i.measurements}:${i.unitPrice}`;
}

interface CartContextValue {
  items: CartItem[];
  add: (item: Omit<CartItem, 'qty' | 'addedAt'>, qty?: number) => void;
  setQty: (lineKey: string, qty: number) => void;
  remove: (lineKey: string) => void;
  clear: () => void;
  subtotal: number;
  count: number;
}

const CartContext = createContext<CartContextValue | null>(null);

/** A persisted line, possibly from an older release — see load()'s normalisers. */
type StoredCartItem = Omit<CartItem, 'includedComponents' | 'excludedComponents'> &
  Partial<Pick<CartItem, 'includedComponents' | 'excludedComponents'>> & {
    includeDupatta?: boolean;
    includeJacket?: boolean;
    dupattaPrice?: number | null;
    jacketPrice?: number | null;
  };

function load(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as StoredCartItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((i) => i && i.variantId && i.qty > 0)
      // Carts saved before set-includes lack the addon fields; their
      // unitPrice was base-only, so "nothing included" is the consistent read.
      .map((i) =>
        typeof i.includeDupatta === 'boolean'
          ? i
          : { ...i, includeDupatta: false, includeJacket: false, dupattaPrice: null, jacketPrice: null },
      )
      // Carts saved before made-to-measure notes lack the field; '' = no note.
      .map((i) => (typeof i.measurements === 'string' ? i : { ...i, measurements: '' }))
      // Carts saved before expiry lack the stamp; treat them as fresh today.
      .map((i) => (typeof i.addedAt === 'number' ? i : { ...i, addedAt: Date.now() }))
      .filter((i) => Date.now() - i.addedAt < CART_TTL_MS)
      // Carts saved before per-product components carry include flags + addon
      // prices; fold them into the component-name arrays. Their snapshotted
      // unitPrice already priced that selection, so it stays as saved.
      .map((i): CartItem => {
        const { includeDupatta, includeJacket, dupattaPrice, jacketPrice, ...rest } = i;
        if (Array.isArray(rest.includedComponents) && Array.isArray(rest.excludedComponents)) {
          return rest as CartItem;
        }
        // An addon price proves the line came from the set-includes UI, where a
        // false flag was a real untick. Without one the flags are synthetic
        // (older cart, or a product with no set pieces) — recording exclusions
        // there would only stop the line merging with a fresh identical add;
        // checkout's expectedUnitPrice guard covers the pricing either way.
        const setEra = dupattaPrice != null || jacketPrice != null;
        return {
          ...rest,
          includedComponents: [
            ...(includeDupatta && dupattaPrice != null ? ['dupatta'] : []),
            ...(includeJacket && jacketPrice != null ? ['jacket'] : []),
          ],
          excludedComponents: setEra
            ? [
                ...(includeDupatta === false ? ['dupatta'] : []),
                ...(includeJacket === false ? ['jacket'] : []),
              ]
            : [],
        };
      });
  } catch {
    return [];
  }
}

export function CartProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<CartItem[]>(load);

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(items));
    } catch {
      /* storage unavailable */
    }
  }, [items]);

  // Reconcile once per boot: a line whose piece or size has left the catalogue
  // is dropped. Network failure keeps every line — fail open, never eat a bag.
  useEffect(() => {
    let cancelled = false;
    const slugs = Array.from(new Set(load().map((i) => i.productSlug).filter(Boolean)));
    if (slugs.length === 0) return;
    void Promise.all(
      slugs.map(async (slug) => {
        try {
          const raw = await api.get<
            { variants?: Array<{ id: string }> } & { product?: { variants?: Array<{ id: string }> } }
          >(`/api/products/${encodeURIComponent(slug)}`);
          const detail = raw.product ?? raw;
          // Only a well-formed detail may drop lines — an unexpected shape
          // must never eat the bag.
          if (!Array.isArray(detail.variants)) return null;
          return { slug, variantIds: new Set(detail.variants.map((v) => v.id)) };
        } catch (e) {
          if ((e as { status?: number }).status === 404) {
            return { slug, variantIds: new Set<string>() };
          }
          return null; // network trouble — leave this slug's lines alone
        }
      }),
    ).then((results) => {
      if (cancelled) return;
      const bySlug = new Map(
        results.filter((r): r is NonNullable<typeof r> => r !== null).map((r) => [r.slug, r.variantIds]),
      );
      setItems((prev) =>
        prev.filter((i) => {
          const ids = bySlug.get(i.productSlug);
          return !ids || ids.has(i.variantId);
        }),
      );
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const add = useCallback((item: Omit<CartItem, 'qty' | 'addedAt'>, qty = 1) => {
    track('add_to_cart', {
      productId: item.productId,
      props: { variantId: item.variantId, size: item.size, color: item.color, qty, price: item.unitPrice },
    });
    const key = cartLineKey(item);
    setItems((prev) => {
      const existing = prev.find((i) => cartLineKey(i) === key);
      if (existing) {
        return prev.map((i) => (cartLineKey(i) === key ? { ...i, qty: i.qty + qty } : i));
      }
      return [...prev, { ...item, qty, addedAt: Date.now() }];
    });
  }, []);

  const setQty = useCallback((lineKey: string, qty: number) => {
    // Track only the variant id — the full line key carries the free-text
    // measurements note, which must not land in the analytics events table.
    if (qty < 1) track('remove_from_cart', { props: { variantId: lineKey.split(':')[0] } });
    setItems((prev) =>
      qty < 1
        ? prev.filter((i) => cartLineKey(i) !== lineKey)
        : prev.map((i) => (cartLineKey(i) === lineKey ? { ...i, qty } : i)),
    );
  }, []);

  const remove = useCallback((lineKey: string) => {
    track('remove_from_cart', { props: { variantId: lineKey.split(':')[0] } });
    setItems((prev) => prev.filter((i) => cartLineKey(i) !== lineKey));
  }, []);

  const clear = useCallback(() => setItems([]), []);

  const subtotal = useMemo(
    () => items.reduce((sum, i) => sum + i.unitPrice * i.qty, 0),
    [items],
  );
  const count = useMemo(() => items.reduce((sum, i) => sum + i.qty, 0), [items]);

  const value = useMemo(
    () => ({ items, add, setQty, remove, clear, subtotal, count }),
    [items, add, setQty, remove, clear, subtotal, count],
  );

  return <CartContext.Provider value={value}>{children}</CartContext.Provider>;
}

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) throw new Error('useCart must be used within CartProvider');
  return ctx;
}
