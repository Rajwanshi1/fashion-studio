import { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db';
import {
  Category,
  DomainError,
  ProductDetail,
  ProductFilter,
  ProductFlag,
  ProductSummary,
  Tx,
  Variant,
} from '../types';

/** Product detail plus fields the admin app and related-lookup need. */
export interface AdminProduct extends ProductDetail {
  categoryId: string;
  createdAt: string;
}

/** Variant joined with product pricing info, read under row lock at order time. */
export interface VariantForOrder {
  id: string;
  productId: string;
  size: string;
  stock: number;
  productName: string;
  color: string;
  /** Base garment price; add-on prices are applied per chosen include. */
  unitPrice: number;
  imageUrl: string | null;
  dupattaPrice: number | null;
  jacketPrice: number | null;
}

export interface CreateCategoryInput {
  slug: string;
  name: string;
  description: string;
  position: number;
}

export interface CreateProductInput {
  categoryId: string;
  slug: string;
  name: string;
  description?: string;
  details?: string;
  price: number;
  color?: string;
  flag?: ProductFlag;
  imageUrl?: string | null;
  active?: boolean;
  collection?: string;
  craft?: string;
  fabric?: string;
  occasion?: string;
  dupattaPrice?: number | null;
  jacketPrice?: number | null;
  variants?: { size: string; stock: number }[];
}

export interface UpdateProductInput {
  categoryId?: string;
  slug?: string;
  name?: string;
  description?: string;
  details?: string;
  price?: number;
  color?: string;
  flag?: ProductFlag;
  imageUrl?: string | null;
  active?: boolean;
  collection?: string;
  craft?: string;
  fabric?: string;
  occasion?: string;
  dupattaPrice?: number | null;
  jacketPrice?: number | null;
}

/** Per-id outcome of a bulk delete: ordered products are archived, the rest removed. */
export interface BulkDeleteResult {
  deleted: string[];
  archived: string[];
}

export interface ProductsRepo {
  listCategories(): Promise<Category[]>;
  listProducts(filter: ProductFilter): Promise<{ items: ProductSummary[]; total: number }>;
  getBySlug(slug: string): Promise<AdminProduct | null>;
  getRelated(productId: string, categoryId: string, limit: number): Promise<ProductSummary[]>;
  getVariantsForUpdate(tx: Tx, variantIds: string[]): Promise<VariantForOrder[]>;
  decrementStock(tx: Tx, variantId: string, qty: number): Promise<void>;
  restock(tx: Tx, variantId: string, qty: number): Promise<void>;
  createCategory(input: CreateCategoryInput): Promise<Category>;
  createProduct(input: CreateProductInput): Promise<AdminProduct>;
  updateProduct(id: string, input: UpdateProductInput): Promise<AdminProduct | null>;
  setVariantStock(variantId: string, stock: number): Promise<Variant | null>;
  listAllProducts(): Promise<AdminProduct[]>;
  listCollections(): Promise<string[]>;
  bulkDelete(ids: string[]): Promise<BulkDeleteResult>;
}

export interface WishlistRepo {
  list(userId: string): Promise<ProductSummary[]>;
  add(userId: string, productId: string): Promise<void>;
  remove(userId: string, productId: string): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'Custom'];

const SUMMARY_SELECT = `
  SELECT p.id, p.slug, p.name, p.price, p.color, p.flag, p.image_url,
         p.collection, p.occasion, p.dupatta_price, p.jacket_price,
         c.slug AS category_slug, c.name AS category_name
  FROM products p JOIN categories c ON c.id = p.category_id`;

const DETAIL_SELECT = `
  SELECT p.*, c.slug AS category_slug, c.name AS category_name
  FROM products p JOIN categories c ON c.id = p.category_id`;

// Price sorts use the full-set price (base + default-included add-ons) so the
// order matches the price shoppers see on the cards.
const ORDER_BY: Record<string, string> = {
  featured: `(p.flag = 'bestseller') IS TRUE DESC, (p.flag = 'new') IS TRUE DESC, p.created_at ASC`,
  new: 'p.created_at DESC',
  price_asc: '(p.price + COALESCE(p.dupatta_price, 0) + COALESCE(p.jacket_price, 0)) ASC',
  price_desc: '(p.price + COALESCE(p.dupatta_price, 0) + COALESCE(p.jacket_price, 0)) DESC',
};

function mapSummary(row: any): ProductSummary {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    price: row.price,
    color: row.color,
    flag: row.flag ?? null,
    imageUrl: row.image_url ?? null,
    categorySlug: row.category_slug,
    categoryName: row.category_name,
    collection: row.collection ?? '',
    occasion: row.occasion ?? '',
    dupattaPrice: row.dupatta_price ?? null,
    jacketPrice: row.jacket_price ?? null,
    // Contract placeholders — the selects do not read these columns yet.
    colorFamily: null,
    salePrice: null,
  };
}

function mapVariant(row: any): Variant {
  return { id: row.id, productId: row.product_id, size: row.size, stock: row.stock };
}

function mapDetail(row: any, variants: Variant[]): AdminProduct {
  return {
    ...mapSummary(row),
    description: row.description,
    details: row.details,
    craft: row.craft ?? '',
    fabric: row.fabric ?? '',
    active: row.active,
    variants,
    // Contract placeholder — the gallery is not loaded yet.
    images: [],
    categoryId: row.category_id,
    createdAt: row.created_at.toISOString(),
  };
}

/** Maps a unique-violation on products.slug to a friendly 409. */
function rethrowSlugTaken(err: any): never {
  if (err?.code === '23505' && err?.constraint === 'products_slug_key') {
    throw new DomainError('SLUG_TAKEN', 'A piece with this slug already exists — choose a different slug');
  }
  throw err;
}

export function createProductsRepo(pool: Pool): ProductsRepo {
  async function loadVariants(client: Pool | PoolClient, productIds: string[]): Promise<Map<string, Variant[]>> {
    const byProduct = new Map<string, Variant[]>();
    if (productIds.length === 0) return byProduct;
    const { rows } = await client.query(
      `SELECT * FROM product_variants WHERE product_id = ANY($1::uuid[])
       ORDER BY array_position($2::text[], size), size`,
      [productIds, DEFAULT_SIZES],
    );
    for (const row of rows) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push(mapVariant(row));
      byProduct.set(row.product_id, list);
    }
    return byProduct;
  }

  async function getById(client: Pool | PoolClient, id: string): Promise<AdminProduct | null> {
    if (!UUID_RE.test(id)) return null;
    const { rows } = await client.query(`${DETAIL_SELECT} WHERE p.id = $1`, [id]);
    if (!rows[0]) return null;
    const variants = await loadVariants(client, [id]);
    return mapDetail(rows[0], variants.get(id) ?? []);
  }

  return {
    async listCategories() {
      const { rows } = await pool.query(
        `SELECT c.*, COUNT(p.id) FILTER (WHERE p.active) AS product_count
         FROM categories c LEFT JOIN products p ON p.category_id = c.id
         GROUP BY c.id ORDER BY c.position, c.slug`,
      );
      return rows.map((row) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        description: row.description,
        position: row.position,
        productCount: Number(row.product_count),
      }));
    },

    async listProducts(filter) {
      const where: string[] = ['p.active', 'p.deleted_at IS NULL'];
      const params: unknown[] = [];
      if (filter.categorySlug) {
        params.push(filter.categorySlug);
        where.push(`c.slug = $${params.length}`);
      }
      if (filter.collection) {
        params.push(filter.collection);
        where.push(`p.collection = $${params.length}`);
      }
      if (filter.search) {
        params.push(`%${filter.search}%`);
        const p = `$${params.length}`;
        where.push(`(p.name ILIKE ${p} OR p.description ILIKE ${p} OR p.color ILIKE ${p})`);
      }
      const whereSql = `WHERE ${where.join(' AND ')}`;
      const { rows: countRows } = await pool.query(
        `SELECT COUNT(*) AS n FROM products p JOIN categories c ON c.id = p.category_id ${whereSql}`,
        params,
      );
      const total = Number(countRows[0].n);
      const orderBy = ORDER_BY[filter.sort ?? 'featured'] ?? ORDER_BY.featured;
      params.push(filter.limit, (filter.page - 1) * filter.limit);
      const { rows } = await pool.query(
        `${SUMMARY_SELECT} ${whereSql} ORDER BY ${orderBy}
         LIMIT $${params.length - 1} OFFSET $${params.length}`,
        params,
      );
      return { items: rows.map(mapSummary), total };
    },

    async getBySlug(slug) {
      const { rows } = await pool.query(`${DETAIL_SELECT} WHERE p.slug = $1 AND p.deleted_at IS NULL`, [slug]);
      if (!rows[0]) return null;
      const variants = await loadVariants(pool, [rows[0].id]);
      return mapDetail(rows[0], variants.get(rows[0].id) ?? []);
    },

    async getRelated(productId, categoryId, limit) {
      const { rows } = await pool.query(
        `${SUMMARY_SELECT}
         WHERE p.active AND p.deleted_at IS NULL AND p.category_id = $1 AND p.id <> $2
         ORDER BY (p.flag IS NOT NULL) DESC, p.created_at ASC LIMIT $3`,
        [categoryId, productId, limit],
      );
      return rows.map(mapSummary);
    },

    async getVariantsForUpdate(tx, variantIds) {
      const client = tx as PoolClient;
      const ids = variantIds.filter((id) => UUID_RE.test(id));
      if (ids.length === 0) return [];
      const { rows } = await client.query(
        `SELECT v.id, v.product_id, v.size, v.stock,
                p.name AS product_name, p.color, p.price AS unit_price, p.image_url,
                p.dupatta_price, p.jacket_price
         FROM product_variants v JOIN products p ON p.id = v.product_id
         WHERE v.id = ANY($1::uuid[]) FOR UPDATE OF v`,
        [ids],
      );
      return rows.map((row) => ({
        id: row.id,
        productId: row.product_id,
        size: row.size,
        stock: row.stock,
        productName: row.product_name,
        color: row.color,
        unitPrice: row.unit_price,
        imageUrl: row.image_url ?? null,
        dupattaPrice: row.dupatta_price ?? null,
        jacketPrice: row.jacket_price ?? null,
      }));
    },

    async decrementStock(tx, variantId, qty) {
      await (tx as PoolClient).query('UPDATE product_variants SET stock = stock - $2 WHERE id = $1', [
        variantId,
        qty,
      ]);
    },

    async restock(tx, variantId, qty) {
      await (tx as PoolClient).query('UPDATE product_variants SET stock = stock + $2 WHERE id = $1', [
        variantId,
        qty,
      ]);
    },

    async createCategory(input) {
      const { rows } = await pool.query(
        `INSERT INTO categories (slug, name, description, position) VALUES ($1, $2, $3, $4)
         ON CONFLICT (slug) DO UPDATE
           SET name = EXCLUDED.name, description = EXCLUDED.description, position = EXCLUDED.position
         RETURNING *`,
        [input.slug, input.name, input.description, input.position],
      );
      const row = rows[0];
      return { id: row.id, slug: row.slug, name: row.name, description: row.description, position: row.position };
    },

    async createProduct(input) {
      const id = await withTransaction(pool, async (client) => {
        let productId: string;
        try {
          const { rows } = await client.query(
            `INSERT INTO products (category_id, slug, name, description, details, price, color, flag, image_url, active,
                                   collection, craft, fabric, occasion, dupatta_price, jacket_price)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16) RETURNING id`,
            [
              input.categoryId,
              input.slug,
              input.name,
              input.description ?? '',
              input.details ?? '',
              input.price,
              input.color ?? '',
              input.flag ?? null,
              input.imageUrl ?? null,
              input.active ?? true,
              input.collection ?? '',
              input.craft ?? '',
              input.fabric ?? '',
              input.occasion ?? '',
              input.dupattaPrice ?? null,
              input.jacketPrice ?? null,
            ],
          );
          productId = rows[0].id;
        } catch (err: any) {
          if (err?.code === '23503' || err?.code === '22P02') {
            throw new DomainError('NOT_FOUND', 'Category not found');
          }
          rethrowSlugTaken(err);
        }
        const variants = input.variants ?? DEFAULT_SIZES.map((size) => ({ size, stock: 0 }));
        for (const v of variants) {
          await client.query('INSERT INTO product_variants (product_id, size, stock) VALUES ($1, $2, $3)', [
            productId,
            v.size,
            v.stock,
          ]);
        }
        return productId;
      });
      return (await getById(pool, id))!;
    },

    async updateProduct(id, input) {
      if (!UUID_RE.test(id)) return null;
      const columns: Record<string, string> = {
        categoryId: 'category_id',
        slug: 'slug',
        name: 'name',
        description: 'description',
        details: 'details',
        price: 'price',
        color: 'color',
        flag: 'flag',
        imageUrl: 'image_url',
        active: 'active',
        collection: 'collection',
        craft: 'craft',
        fabric: 'fabric',
        occasion: 'occasion',
        dupattaPrice: 'dupatta_price',
        jacketPrice: 'jacket_price',
      };
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, column] of Object.entries(columns)) {
        const value = (input as Record<string, unknown>)[key];
        if (value !== undefined) {
          params.push(value);
          sets.push(`${column} = $${params.length}`);
        }
      }
      if (sets.length === 0) return getById(pool, id);
      let rowCount: number | null;
      try {
        ({ rowCount } = await pool.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $1`, params));
      } catch (err: any) {
        rethrowSlugTaken(err);
      }
      if (!rowCount) return null;
      return getById(pool, id);
    },

    async setVariantStock(variantId, stock) {
      if (!UUID_RE.test(variantId)) return null;
      const { rows } = await pool.query(
        'UPDATE product_variants SET stock = $2 WHERE id = $1 RETURNING *',
        [variantId, stock],
      );
      return rows[0] ? mapVariant(rows[0]) : null;
    },

    async listAllProducts() {
      const { rows } = await pool.query(
        `${DETAIL_SELECT} WHERE p.deleted_at IS NULL ORDER BY p.created_at ASC, p.slug`,
      );
      const variants = await loadVariants(pool, rows.map((r) => r.id));
      return rows.map((row) => mapDetail(row, variants.get(row.id) ?? []));
    },

    async listCollections() {
      const { rows } = await pool.query(
        `SELECT DISTINCT collection FROM products
         WHERE active AND deleted_at IS NULL AND collection <> ''
         ORDER BY collection`,
      );
      return rows.map((row) => row.collection as string);
    },

    async bulkDelete(ids) {
      const valid = ids.filter((id) => UUID_RE.test(id));
      if (valid.length === 0) return { deleted: [], archived: [] };
      return withTransaction(pool, async (client) => {
        // Ordered products stay for order history: archive them (hidden
        // everywhere, slug freed for re-use). The rest are removed outright —
        // variants and wishlist rows cascade.
        const { rows: archivedRows } = await client.query(
          `UPDATE products
              SET deleted_at = now(), active = false,
                  slug = slug || '-archived-' || to_char(now(), 'YYYYMMDDHH24MISS')
            WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
              AND EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = products.id)
            RETURNING id`,
          [valid],
        );
        const { rows: deletedRows } = await client.query(
          `DELETE FROM products
            WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL
              AND NOT EXISTS (SELECT 1 FROM order_items oi WHERE oi.product_id = products.id)
            RETURNING id`,
          [valid],
        );
        return {
          deleted: deletedRows.map((r) => r.id as string),
          archived: archivedRows.map((r) => r.id as string),
        };
      });
    },
  };
}

export function createWishlistRepo(pool: Pool): WishlistRepo {
  return {
    async list(userId) {
      const { rows } = await pool.query(
        `SELECT p.id, p.slug, p.name, p.price, p.color, p.flag, p.image_url,
                p.collection, p.occasion, p.dupatta_price, p.jacket_price,
                c.slug AS category_slug, c.name AS category_name
         FROM wishlists w
         JOIN products p ON p.id = w.product_id
         JOIN categories c ON c.id = p.category_id
         WHERE w.user_id = $1 AND p.active AND p.deleted_at IS NULL
         ORDER BY w.created_at DESC`,
        [userId],
      );
      return rows.map(mapSummary);
    },

    async add(userId, productId) {
      if (!UUID_RE.test(productId)) throw new DomainError('NOT_FOUND', 'Product not found');
      const { rows } = await pool.query('SELECT 1 FROM products WHERE id = $1', [productId]);
      if (!rows[0]) throw new DomainError('NOT_FOUND', 'Product not found');
      await pool.query(
        'INSERT INTO wishlists (user_id, product_id) VALUES ($1, $2) ON CONFLICT DO NOTHING',
        [userId, productId],
      );
    },

    async remove(userId, productId) {
      if (!UUID_RE.test(productId)) return;
      await pool.query('DELETE FROM wishlists WHERE user_id = $1 AND product_id = $2', [userId, productId]);
    },
  };
}
