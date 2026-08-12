import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode,
} from 'react';
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
}

/** Line identity: variant + set-includes selection + measurements note. */
export function cartLineKey(
  i: Pick<CartItem, 'variantId' | 'excludedComponents' | 'measurements'>,
): string {
  return `${i.variantId}:${[...i.excludedComponents].sort().join(',')}:${i.measurements}`;
}

interface CartContextValue {
  items: CartItem[];
  add: (item: Omit<CartItem, 'qty'>, qty?: number) => void;
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
      // Carts saved before per-product components carry include flags + addon
      // prices; fold them into the component-name arrays. Their snapshotted
      // unitPrice already priced that selection, so it stays as saved.
      .map((i): CartItem => {
        const { includeDupatta, includeJacket, dupattaPrice, jacketPrice, ...rest } = i;
        if (Array.isArray(rest.includedComponents) && Array.isArray(rest.excludedComponents)) {
          return rest as CartItem;
        }
        return {
          ...rest,
          includedComponents: [
            ...(includeDupatta && dupattaPrice != null ? ['dupatta'] : []),
            ...(includeJacket && jacketPrice != null ? ['jacket'] : []),
          ],
          excludedComponents: [
            ...(includeDupatta === false ? ['dupatta'] : []),
            ...(includeJacket === false ? ['jacket'] : []),
          ],
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

  const add = useCallback((item: Omit<CartItem, 'qty'>, qty = 1) => {
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
      return [...prev, { ...item, qty }];
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
