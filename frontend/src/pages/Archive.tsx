import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { api } from '../lib/api';
import { useSiteContent } from '../lib/content';
import type { ProductsResponse } from '../lib/types';
import Shop from '../components/Shop';
import ImageSlot from '../components/ImageSlot';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import { usePageTitle } from '../lib/usePageTitle';
import '../styles/archive.css';

/**
 * The permanent record (audit §06): every edition the house makes lives here,
 * forever — "Volume 01, sold out" is worth more than five imaginary editions.
 * Volumes come from the CMS; piece counts are COMPUTED from the catalogue by
 * matching each volume's sub-collection names, never typed.
 */
export default function Archive() {
  usePageTitle('The Archive');
  const { archive } = useSiteContent();
  const [countByCollection, setCountByCollection] = useState<Map<string, number> | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ProductsResponse>('/api/products?page=1&limit=100')
      .then((d) => {
        if (cancelled) return;
        const counts = new Map<string, number>();
        for (const item of d.items) {
          if (!item.collection) continue;
          counts.set(item.collection, (counts.get(item.collection) ?? 0) + 1);
        }
        setCountByCollection(counts);
      })
      .catch(() => undefined); // counts are decorative — the volumes still render
    return () => {
      cancelled = true;
    };
  }, []);

  const volumeCount = (collections: string[]): number | null => {
    if (!countByCollection) return null;
    return collections.reduce((sum, name) => sum + (countByCollection.get(name) ?? 0), 0);
  };

  return (
    <Shop page="page-archive">
      <div className="crumbs">
        <Link to="/">Home</Link>
        <span className="sep">/</span>
        <span className="here">The Archive</span>
      </div>

      <div className="page-hero">
        <span className="eyebrow">The House</span>
        <h1>The Archive</h1>
        <p>{archive.intro}</p>
      </div>

      <main className="archive">
        {archive.volumes.map((vol, i) => {
          const count = volumeCount(vol.collections);
          return (
            <article className={`vol${i % 2 === 1 ? ' flip' : ''}`} key={`${vol.volumeNo}-${i}`}>
              <ImageSlot
                src={vol.imageUrl}
                label={`${vol.volumeNo} — ${vol.title}`}
                alt={`${vol.volumeNo} — ${vol.title}`}
                focusX={vol.focusX}
                focusY={vol.focusY}
              />
              <div className="vol-text">
                <span className="eyebrow">
                  {vol.volumeNo}
                  {vol.season && <> · {vol.season}</>}
                </span>
                <h2>{vol.title}</h2>
                {vol.copy && <p>{vol.copy}</p>}
                <p className="vol-meta">
                  {count !== null && count > 0 && <span>{count} pieces</span>}
                  {vol.collections.length > 0 && <span>{vol.collections.join(' · ')}</span>}
                  {vol.status && <span>{vol.status}</span>}
                </p>
                <Link className="btn btn-line" to="/collection">
                  Explore the Pieces →
                </Link>
              </div>
            </article>
          );
        })}
      </main>
      <Reveal watch={archive.volumes.length} />
      <Ambient watch={archive.volumes.length} />
    </Shop>
  );
}
