import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { track } from '../lib/analytics';
import { displayPrice, displaySalePrice } from '../lib/format';
import type { ProductsResponse, ProductSummary } from '../lib/types';
import ImageSlot from './ImageSlot';
import Price from './Price';
import SearchIcon from './SearchIcon';
import '../styles/nav-search.css';

/** Inline search dropdown under the top bar: quick hits linking to the PDP,
 *  with a View-all link into the full /search page for deeper digging. */
export default function NavSearch({ onClose }: { onClose: () => void }) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<ProductSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const lastTrackedQueryRef = useRef<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const rootRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  // Escape or a press outside dismisses — a dropdown, so no body scroll-lock.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    const onDown = (e: MouseEvent) => {
      if (rootRef.current && !rootRef.current.contains(e.target as Node)) onClose();
    };
    document.addEventListener('keydown', onKey);
    document.addEventListener('mousedown', onDown);
    return () => {
      document.removeEventListener('keydown', onKey);
      document.removeEventListener('mousedown', onDown);
    };
  }, [onClose]);

  // Live results — debounced fetch (the /search page idiom, quick-hit limit).
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setTotal(0);
      setError(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get<ProductsResponse>(`/api/products?search=${encodeURIComponent(q)}&page=1&limit=6`)
        .then((d) => {
          setResults(d.items);
          setTotal(d.total);
          setError(null);
          if (lastTrackedQueryRef.current !== q) {
            lastTrackedQueryRef.current = q;
            track('search', { props: { query: q, results: d.total } });
          }
        })
        .catch((e: { message?: string }) => {
          setError(e.message ?? 'Search is unavailable right now.');
          setResults([]);
          setTotal(0);
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const q = query.trim();

  return (
    <div className="nav-search" ref={rootRef}>
      <div className="nav-search-bar">
        <span className="ic">
          <SearchIcon />
        </span>
        <input
          ref={inputRef}
          type="text"
          aria-label="Search"
          placeholder="sage lehenga"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button className="x" aria-label="Close search" onClick={onClose}>
          ✕
        </button>
      </div>
      {q && (
        <div className="nav-search-results">
          {error ? (
            <p className="note">{error}</p>
          ) : results.length === 0 ? (
            <p className="note">{loading ? 'Searching…' : 'Nothing found.'}</p>
          ) : (
            <>
              {results.map((p) => {
                const salePrice = displaySalePrice(p);
                return (
                  <Link className="hit" key={p.id} to={`/product/${p.slug}`} onClick={onClose}>
                    <ImageSlot
                      src={p.imageUrl}
                      label={p.name}
                      alt={p.name}
                      width={p.imageWidth}
                      height={p.imageHeight}
                      placeholderHex={p.imageColorHex || undefined}
                      sizes="44px"
                    />
                    <span className="nm">{p.name}</span>
                    <span className="pr">
                      {salePrice != null && (
                        <s className="was">
                          <Price paise={displayPrice(p)} />
                        </s>
                      )}
                      <Price paise={salePrice ?? displayPrice(p)} />
                    </span>
                  </Link>
                );
              })}
              {total > results.length && (
                <Link className="all" to={`/search?q=${encodeURIComponent(q)}`} onClick={onClose}>
                  View all {total} results
                </Link>
              )}
            </>
          )}
        </div>
      )}
    </div>
  );
}
