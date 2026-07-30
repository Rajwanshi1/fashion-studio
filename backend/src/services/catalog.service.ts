import type { AdminProduct, ProductsRepo } from '../data/products.repo';
import { Category, DomainError, ProductSort, ProductSummary } from '../types';

export interface ListProductsQuery {
  category?: string;
  collection?: string;
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

export interface CatalogService {
  listCategories(): Promise<Category[]>;
  listCollections(): Promise<string[]>;
  listProducts(query: ListProductsQuery): Promise<ProductListing>;
  getProduct(slug: string): Promise<AdminProduct & { related: ProductSummary[] }>;
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
        search,
        sort: query.sort ?? 'featured',
        page,
        limit,
      });
      return { items, total, page, pages: Math.max(1, Math.ceil(total / limit)) };
    },

    async getProduct(slug) {
      const product = await deps.products.getBySlug(slug);
      if (!product || !product.active) throw new DomainError('NOT_FOUND', 'Product not found');
      const related = await deps.products.getRelated(product.id, product.categoryId, RELATED_LIMIT);
      return { ...product, related };
    },
  };
}
