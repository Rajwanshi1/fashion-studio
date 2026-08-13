import { useEffect, useState } from 'react';
import { api } from './api';
import type { Category } from './types';

/** Categories with pieces in them, position-ordered. Module-cached: the same
 *  list feeds the homepage tiles, the footer Shop column and the PLP sidebar,
 *  one fetch per visit. Empty categories are hidden everywhere — a door to an
 *  empty room does the brand more harm than a shorter list (audit §02). */

let cache: Category[] | null = null;
let inflight: Promise<Category[]> | null = null;

async function fetchCategories(): Promise<Category[]> {
  const data = await api.get<Category[] | { items: Category[] }>('/api/categories');
  const list = Array.isArray(data) ? data : data.items;
  return (list ?? []).slice().sort((a, b) => a.position - b.position);
}

export function useLiveCategories(): Category[] {
  const [cats, setCats] = useState<Category[]>(cache ?? []);
  useEffect(() => {
    if (cache) return;
    inflight ??= fetchCategories().then((list) => {
      cache = list;
      return list;
    });
    let cancelled = false;
    inflight
      .then((list) => {
        if (!cancelled) setCats(list);
      })
      .catch(() => undefined); // fetch failure → empty; consumers hide gracefully
    return () => {
      cancelled = true;
    };
  }, []);
  // productCount is optional on the wire; treat unknown as empty, not full.
  return cats.filter((c) => (c.productCount ?? 0) > 0);
}
