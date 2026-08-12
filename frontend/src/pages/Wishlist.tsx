import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { api } from '../lib/api';
import { effectiveBasePrice } from '../lib/format';
import type { ProductDetail, ProductSummary, ProductsResponse } from '../lib/types';
import { useCart } from '../lib/cart';
import { useWishlist } from '../lib/wishlist';
import { useCartDrawer } from '../components/CartDrawer';
import { useToast } from '../components/Toast';
import Shop from '../components/Shop';
import ImageSlot from '../components/ImageSlot';
import Price from '../components/Price';
import Reveal from '../components/Reveal';
import Ambient from '../components/Ambient';
import '../styles/wishlist.css';

export default function Wishlist() {
  const wishlist = useWishlist();
  const cart = useCart();
  const { openDrawer } = useCartDrawer();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [all, setAll] = useState<ProductSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    api
      .get<ProductsResponse>('/api/products?page=1&limit=100')
      .then((d) => {
        if (!cancelled) setAll(d.items);
      })
      .catch((e: { message?: string }) => {
        if (!cancelled) setError(e.message ?? 'Unable to load your wishlist right now.');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const saved = all.filter((p) => wishlist.ids.includes(p.id));

  const addToBag = async (p: ProductSummary) => {
    try {
      const raw = await api.get<ProductDetail | { product: ProductDetail }>(
        `/api/products/${p.slug}`,
      );
      const detail = 'product' in raw && raw.product ? raw.product : (raw as ProductDetail);
      const variant = detail.variants.find((v) => v.stock > 0) ?? detail.variants[0];
      if (!variant) {
        navigate(`/product/${p.slug}`);
        return;
      }
      // Wishlist adds default to the full set — every piece included.
      cart.add({
        variantId: variant.id,
        productId: detail.id,
        productSlug: detail.slug,
        name: detail.name,
        size: variant.size,
        color: detail.color,
        unitPrice: effectiveBasePrice(detail) + detail.addonsTotal,
        imageUrl: detail.imageUrl,
        includedComponents: detail.components
          .filter((c) => c.optional && c.price != null)
          .map((c) => c.name),
        excludedComponents: [],
        measurements: '',
      });
      showToast('Added to your bag');
      openDrawer();
    } catch {
      navigate(`/product/${p.slug}`);
    }
  };

  const empty = !loading && !error && saved.length === 0;

  return (
    <Shop page="page-wishlist">
      <div className="crumbs">
        <Link to="/account">Account</Link>
        <span className="sep">/</span>
        <span className="here">Wishlist</span>
      </div>

      <div className="page-hero">
        <span className="eyebrow">Saved for Later</span>
        <h1>Your Wishlist</h1>
        <p>
          The pieces you're considering. Move them to your bag whenever you're ready — each is
          made to order.
        </p>
      </div>

      <main className="wl">
        {loading && <p className="api-note">Gathering your saved pieces…</p>}
        {error && <p className="api-note err">{error}</p>}

        {saved.length > 0 && (
          <div className="pgrid cols-4" id="wlgrid">
            {saved.map((p) => (
              <div className="pcard" key={p.id}>
                <div className="ph">
                  <Link to={`/product/${p.slug}`}>
                    <ImageSlot src={p.imageUrl} label={p.name} alt={p.name} />
                  </Link>
                </div>
                <div className="m">
                  <div>
                    <div className="cat">{p.categoryName}</div>
                    <div className="nm">
                      <Link to={`/product/${p.slug}`}>{p.name}</Link>
                    </div>
                    <div className="pr">
                      <Price paise={p.price} />
                    </div>
                  </div>
                </div>
                <div className="actions">
                  <button className="bag-it" onClick={() => void addToBag(p)}>
                    + Add to Bag
                  </button>
                  <button className="rm" onClick={() => wishlist.remove(p.id)}>
                    Remove
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}

        {empty && (
          <div className="empty" id="empty">
            <div className="heart">♡</div>
            <h2>Your wishlist is empty</h2>
            <p>Save the pieces you love and they'll wait for you here.</p>
            <Link className="btn btn-line" to="/collection">
              Explore the Collection →
            </Link>
          </div>
        )}
      </main>
      <Reveal watch={saved.length} />
      <Ambient watch={saved.length} />
    </Shop>
  );
}
