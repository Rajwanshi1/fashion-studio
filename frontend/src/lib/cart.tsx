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
  /** Set pieces kept in this line — the same variant with a different
   *  selection is a separate cart line (see cartLineKey). */
  includeDupatta: boolean;
  includeJacket: boolean;
  /** Price of the kept add-on; null = excluded or not part of the set. */
  dupattaPrice: number | null;
  jacketPrice: number | null;
}

/** Line identity: variant + set-includes selection. */
export function cartLineKey(
  i: Pick<CartItem, 'variantId' | 'includeDupatta' | 'includeJacket'>,
): string {
  return `${i.variantId}:${i.includeDupatta ? 1 : 0}${i.includeJacket ? 1 : 0}`;
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

function load(): CartItem[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as CartItem[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter((i) => i && i.variantId && i.qty > 0)
      // Carts saved before set-includes lack the addon fields; their
      // unitPrice was base-only, so "nothing included" is the consistent read.
      .map((i) =>
        typeof i.includeDupatta === 'boolean'
          ? i
          : { ...i, includeDupatta: false, includeJacket: false, dupattaPrice: null, jacketPrice: null },
      );
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
    if (qty < 1) track('remove_from_cart', { props: { variantId: lineKey } });
    setItems((prev) =>
      qty < 1
        ? prev.filter((i) => cartLineKey(i) !== lineKey)
        : prev.map((i) => (cartLineKey(i) === lineKey ? { ...i, qty } : i)),
    );
  }, []);

  const remove = useCallback((lineKey: string) => {
    track('remove_from_cart', { props: { variantId: lineKey } });
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
