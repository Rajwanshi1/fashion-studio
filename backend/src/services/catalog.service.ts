import type { AdminProduct, ProductsRepo } from '../data/products.repo';
import { Category, ColorFamily, DomainError, ProductSort, ProductSummary } from '../types';

export interface ListProductsQuery {
  category?: string;
  collection?: string;
  color?: ColorFamily;
  search?: string;
  sort?: ProductSort;
  page?: number;
  limit?: number;
}

export interface ProductListing {
  items: ProductSummary[];
  total: number;
  page: number;
  pages: number;
}

/** Everything the admin sees except the cost price, which is never public. */
export type PublicProduct = Omit<AdminProduct, 'costPrice'>;

export interface CatalogService {
  listCategories(): Promise<Category[]>;
  listCollections(): Promise<string[]>;
  listProducts(query: ListProductsQuery): Promise<ProductListing>;
  getProduct(slug: string): Promise<PublicProduct & { related: ProductSummary[] }>;
}

const DEFAULT_LIMIT = 12;
const MAX_LIMIT = 100;
const RELATED_LIMIT = 4;

export function createCatalogService(deps: { products: ProductsRepo }): CatalogService {
  return {
    listCategories() {
      return deps.products.listCategories();
    },

    listCollections() {
      return deps.products.listCollections();
    },

    async listProducts(query) {
      const page = Math.max(1, Math.floor(query.page ?? 1));
      const limit = Math.min(MAX_LIMIT, Math.max(1, Math.floor(query.limit ?? DEFAULT_LIMIT)));
      const search = query.search?.trim() || undefined;
      const { items, total } = await deps.products.listProducts({
        categorySlug: query.category?.trim() || undefined,
        collection: query.collection?.trim() || undefined,
        colorFamily: query.color,
        search,
        sort: query.sort ?? 'featured',
        page,
        limit,
      });
      return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
    },

    async getProduct(slug) {
      const found = await deps.products.getBySlug(slug);
      if (!found || !found.active) throw new DomainError('NOT_FOUND', 'Product not found');
      const related = await deps.products.getRelated(found.id, found.categoryId, RELATED_LIMIT);
      // The storefront is the one caller that must never see the cost price.
      const { costPrice, ...product } = found;
      return { ...product, related };
    },
  };
}
