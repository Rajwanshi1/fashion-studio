import { useEffect, useRef, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { track } from '../lib/analytics';
import type { ProductsResponse, ProductSummary } from '../lib/types';
import Shop from '../components/Shop';
import ProductCard from '../components/ProductCard';
import SearchIcon from '../components/SearchIcon';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/search.css';
import { usePageTitle } from '../lib/usePageTitle';

const POPULAR = ['Lehenga', 'Anarkali', 'Bridal', 'Sage', 'Made to Measure'];

export default function Search() {
  usePageTitle('Search');
  const [params, setParams] = useSearchParams();
  const [query, setQuery] = useState(params.get('q') ?? '');
  const [results, setResults] = useState<ProductSummary[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [searched, setSearched] = useState('');
  const lastTrackedQueryRef = useRef<string | null>(null);

  // Live results — debounced fetch.
  useEffect(() => {
    const q = query.trim();
    if (!q) {
      setResults([]);
      setTotal(0);
      setSearched('');
      setError(null);
      return;
    }
    setLoading(true);
    const t = setTimeout(() => {
      api
        .get<ProductsResponse>(`/api/products?search=${encodeURIComponent(q)}&page=1&limit=12`)
        .then((d) => {
          setResults(d.items);
          setTotal(d.total);
          setSearched(q);
          setError(null);
          if (lastTrackedQueryRef.current !== q) {
            lastTrackedQueryRef.current = q;
            track('search', { props: { query: q, results: d.total } });
          }
        })
        .catch((e: { message?: string }) => {
          setError(e.message ?? 'Search is unavailable right now.');
          setResults([]);
          setSearched(q);
        })
        .finally(() => setLoading(false));
    }, 300);
    return () => clearTimeout(t);
  }, [query]);

  const choose = (q: string) => {
    setQuery(q);
    const next = new URLSearchParams(params);
    next.set('q', q);
    setParams(next, { replace: true });
  };

  return (
    <Shop page="page-search">
      <section className="search-band">
        <span className="eyebrow">Find Your Piece</span>
        <div className="search-box">
          <span className="ic">
            <SearchIcon />
          </span>
          <input
            type="text"
            aria-label="Search"
            placeholder="sage lehenga"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="suggest">
          <span className="lbl">Popular</span>
          {POPULAR.map((p) => (
            <button className="chip" key={p} onClick={() => choose(p)}>
              {p}
            </button>
          ))}
        </div>
      </section>

      {searched && (
        <section className="results">
          <div className="results-head">
            <h2>
              Results for <em>"{searched}"</em>
            </h2>
            <span className="count">
              {loading ? 'Searching…' : `${total} ${total === 1 ? 'Piece' : 'Pieces'}`}
            </span>
          </div>
          {error ? (
            <p className="api-note err">{error}</p>
          ) : results.length === 0 && !loading ? (
            <p className="api-note">Nothing found — try one of the popular searches above.</p>
          ) : (
            <div className="pgrid cols-4">
              {results.map((p, i) => (
                <ProductCard key={p.id} product={p} fav={false} quick={false} eager={i < 4} />
              ))}
            </div>
          )}
        </section>
      )}
      <Reveal watch={results.length + (searched ? 1 : 0)} />
      <Ambient watch={results.length} />
    </Shop>
  );
}
