import { describe, expect, it } from 'vitest';
import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { CartProvider, useCart, type CartItem } from '../lib/cart';

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
};
const other: Omit<CartItem, 'qty'> = {
  ...base,
  variantId: 'v2',
  size: 'M',
  unitPrice: 17200000,
};

describe('cart context', () => {
  it('adds items and merges the same variant', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => result.current.add(base));
    act(() => result.current.add(base, 2));
    expect(result.current.items).toHaveLength(1);
    expect(result.current.items[0].qty).toBe(3);
    expect(result.current.count).toBe(3);
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
    act(() => result.current.setQty('v1', 5));
    expect(result.current.items[0].qty).toBe(5);
    act(() => result.current.setQty('v1', 0));
    expect(result.current.items).toHaveLength(0);
  });

  it('remove and clear empty the bag', () => {
    const { result } = renderHook(() => useCart(), { wrapper });
    act(() => {
      result.current.add(base);
      result.current.add(other);
    });
    act(() => result.current.remove('v1'));
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
});
