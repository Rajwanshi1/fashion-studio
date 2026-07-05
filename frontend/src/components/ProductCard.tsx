import { Link, useNavigate } from 'react-router-dom';
import type { ProductSummary } from '../lib/types';
import { useWishlist } from '../lib/wishlist';
import ImageSlot from './ImageSlot';
import Price from './Price';

const FLAG_LABEL: Record<string, string> = { bestseller: 'Bestseller', new: 'New' };

interface ProductCardProps {
  product: ProductSummary;
  /** Show the hover heart (PLP variant). */
  fav?: boolean;
  /** Show the slide-up Quick View bar. */
  quick?: boolean;
}

/** `.pcard` product card per shop.css (flag / fav / quick-view variants). */
export default function ProductCard({ product, fav = true, quick = true }: ProductCardProps) {
  const wishlist = useWishlist();
  const navigate = useNavigate();
  const saved = wishlist.has(product.id);

  return (
    <Link className="pcard" to={`/product/${product.slug}`}>
      <div className="ph">
        {product.flag && <span className="flag">{FLAG_LABEL[product.flag]}</span>}
        {fav && (
          <button
            className={`fav${saved ? ' on' : ''}`}
            aria-label="Save"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              wishlist.toggle(product.id);
            }}
          >
            {saved ? '♥' : '♡'}
          </button>
        )}
        <ImageSlot src={product.imageUrl} label={product.name} alt={product.name} />
        {quick && (
          <button
            className="quick"
            onClick={(e) => {
              e.preventDefault();
              e.stopPropagation();
              navigate(`/product/${product.slug}`);
            }}
          >
            Quick View
          </button>
        )}
      </div>
      <div className="m">
        <div className="cat">{product.categoryName}</div>
        <div className="nm">{product.name}</div>
        <div className="pr">
          <Price paise={product.price} />
        </div>
      </div>
    </Link>
  );
}
