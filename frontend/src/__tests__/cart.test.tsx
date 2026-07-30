import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CartProvider, cartLineKey, useCart, type CartItem } from '../lib/cart';

const wrapper = ({ children }: { children: ReactNode }) => <CartProvider>{children}</CartProvider>;

const base: Omit<CartItem, 'qty'> = {
  variantId: 'v1',
  productId: 'p1',
  productSlug: 'sage-sequin-jacket-lehenga',
  name: 'Sage Sequin Jacket Lehenga',
  size: 'S',
  color: 'Sage',
  unitPrice: 18400000,
  imageUrl: null,
  includeDupatta: false,
  includeJacket: false,
  dupattaPrice: null,
  jacketPrice: null,
};
const other: Omit<CartItem, 'qty'> = {
  ...base,
  variantId: 'v2',
  size: 'M',
  unitPrice: 17200000,
};
// Same variant as `base`, but with the set pieces kept — a distinct line.
const fullSet: Omit<CartItem, 'qty'> = {
  ...base,
  unitPrice: 18400000 + 1200000 + 2400000,
  includeDupatta: true,
  includeJacket: true,
  dupattaPrice: 1200000,
  jacketPrice: 2400000,
};

describe('cart context', () => {
  it('adds items and merges the same variant + selection', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add(base));
    act(() => result.current.add(base, 2));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].qty).toBe(3);
    expect(result.current.count).toBe(3);
  });

  it('keeps the same variant with a different set selection as its own line', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add(base));
    act(() => result.current.add(fullSet));
    expect(result.current.items).toHaveLength(2);
    expect(result.current.subtotal).toBe(18400000 + 22000000);
    // Removing one line leaves the other untouched.
    act(() => result.current.remove(cartLineKey(fullSet)));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].includeDupatta).toBe(false);
  });

  it('computes subtotal across variants', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add(base, 2));
    act(() => result.current.add(other));
    expect(result.current.subtotal).toBe(18400000 * 2 + 17200000);
    expect(result.current.count).toBe(3);
  });

  it('setQty updates quantity and removes at zero', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add(base));
    act(() => result.current.setQty(cartLineKey(base), 5));
    expect(result.current.items[0].qty).toBe(5);
    act(() => result.current.setQty(cartLineKey(base), 0));
    expect(result.current.items).toHaveLength(0);
  });

  it('remove and clear empty the bag', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.add(base);
      result.current.add(other);
    });
    act(() => result.current.remove(cartLineKey(base)));
    expect(result.current.items.map((i) => i.variantId)).toEqual(['v2']);
    act(() => result.current.clear());
    expect(result.current.items).toHaveLength(0);
    expect(result.current.subtotal).toBe(0);
  });

  it('persists to localStorage under ta.cart and rehydrates', () => {
    const { result, unmount } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add(base, 2));
    const stored = JSON.parse(localStorage.getItem('ta.cart') ?? '[]') as CartItem[];
    expect(stored).toHaveLength(1);
    expect(stored[0].qty).toBe(2);
    unmount();

    const { result: next } = renderHook(() => useCart(), { wrapper });
    expect(next.current.items).toHaveLength(1);
    expect(next.current.items[0].variantId).toBe('v1');
    expect(next.current.count).toBe(2);
  });

  it('normalizes carts saved before set-includes existed', () => {
    // Old shape: no include/addon fields at all.
    localStorage.setItem(
      'ta.cart',
      JSON.stringify([
        {
          variantId: 'v1',
          productId: 'p1',
          productSlug: 'sage-sequin-jacket-lehenga',
          name: 'Sage Sequin Jacket Lehenga',
          size: 'S',
          color: 'Sage',
          unitPrice: 18400000,
          qty: 2,
          imageUrl: null,
        },
      ]),
    );
    const { result } = renderHook(() => useCart(), { wrapper });
    expect(result.current.items).toHaveLength(1);
    const item = result.current.items[0];
    // Old unitPrice was base-only, so nothing reads as included.
    expect(item.includeDupatta).toBe(false);
    expect(item.includeJacket).toBe(false);
    expect(item.dupattaPrice).toBeNull();
    expect(item.jacketPrice).toBeNull();
    expect(cartLineKey(item)).toBe('v1:00');
    expect(result.current.subtotal).toBe(2 * 18400000);
  });
});
