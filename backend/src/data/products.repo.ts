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
  unitPrice: number;
  imageUrl: string | null;
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
}

export interface ProductsRepo {
  listCategories(): Promise<Category[]>;
  listProducts(filter: ProductFilter): Promise<{ items: ProductSummary[]; total: number }>;
  getBySlug(slug: string): Promise<AdminProduct | null>;
  getById(id: string): Promise<AdminProduct | null>;
  getRelated(productId: string, categoryId: string, limit: number): Promise<ProductSummary[]>;
  getVariantsForUpdate(tx: Tx, variantIds: string[]): Promise<VariantForOrder[]>;
  decrementStock(tx: Tx, variantId: string, qty: number): Promise<void>;
  restock(tx: Tx, variantId: string, qty: number): Promise<void>;
  createCategory(input: CreateCategoryInput): Promise<Category>;
  createProduct(input: CreateProductInput): Promise<AdminProduct>;
  updateProduct(id: string, input: UpdateProductInput): Promise<AdminProduct | null>;
  setVariantStock(variantId: string, stock: number): Promise<Variant | null>;
  setVariantStocks(productId: string, updates: { variantId: string; stock: number }[]): Promise<AdminProduct | null>;
  listAllProducts(): Promise<AdminProduct[]>;
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
         c.slug AS category_slug, c.name AS category_name
  FROM products p JOIN categories c ON c.id = p.category_id`;

const DETAIL_SELECT = `
  SELECT p.*, c.slug AS category_slug, c.name AS category_name
  FROM products p JOIN categories c ON c.id = p.category_id`;

const ORDER_BY: Record<string, string> = {
  featured: `(p.flag = 'bestseller') IS TRUE DESC, (p.flag = 'new') IS TRUE DESC, p.created_at ASC`,
  new: 'p.created_at DESC',
  price_asc: 'p.price ASC',
  price_desc: 'p.price DESC',
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
    active: row.active,
    variants,
    categoryId: row.category_id,
    createdAt: row.created_at.toISOString(),
  };
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
      const where: string[] = ['p.active'];
      const params: unknown[] = [];
      if (filter.categorySlug) {
        params.push(filter.categorySlug);
        where.push(`c.slug = $${params.length}`);
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
      const { rows } = await pool.query(`${DETAIL_SELECT} WHERE p.slug = $1`, [slug]);
      if (!rows[0]) return null;
      const variants = await loadVariants(pool, [rows[0].id]);
      return mapDetail(rows[0], variants.get(rows[0].id) ?? []);
    },

    async getById(id) {
      return getById(pool, id);
    },

    async getRelated(productId, categoryId, limit) {
      const { rows } = await pool.query(
        `${SUMMARY_SELECT}
         WHERE p.active AND p.category_id = $1 AND p.id <> $2
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
                p.name AS product_name, p.color, p.price AS unit_price, p.image_url
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
            `INSERT INTO products (category_id, slug, name, description, details, price, color, flag, image_url, active)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10) RETURNING id`,
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
            ],
          );
          productId = rows[0].id;
        } catch (err: any) {
          if (err?.code === '23503' || err?.code === '22P02') {
            throw new DomainError('NOT_FOUND', 'Category not found');
          }
          throw err;
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
      const { rowCount } = await pool.query(`UPDATE products SET ${sets.join(', ')} WHERE id = $1`, params);
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

    async setVariantStocks(productId, updates) {
      if (!UUID_RE.test(productId)) return null;
      const ids = updates.map((u) => u.variantId);
      if (!ids.every((id) => UUID_RE.test(id))) return null;
      return withTransaction(pool, async (client) => {
        const { rows } = await client.query(
          'SELECT id FROM product_variants WHERE product_id = $1 AND id = ANY($2::uuid[])',
          [productId, ids],
        );
        const owned = new Set(rows.map((row) => row.id));
        if (!ids.every((id) => owned.has(id))) return null;
        for (const u of updates) {
          await client.query('UPDATE product_variants SET stock = $2 WHERE id = $1', [u.variantId, u.stock]);
        }
        return getById(client, productId);
      });
    },

    async listAllProducts() {
      const { rows } = await pool.query(`${DETAIL_SELECT} ORDER BY p.created_at ASC, p.slug`);
      const variants = await loadVariants(pool, rows.map((r) => r.id));
      return rows.map((row) => mapDetail(row, variants.get(row.id) ?? []));
    },
  };
}

export function createWishlistRepo(pool: Pool): WishlistRepo {
  return {
    async list(userId) {
      const { rows } = await pool.query(
        `SELECT p.id, p.slug, p.name, p.price, p.color, p.flag, p.image_url,
                c.slug AS category_slug, c.name AS category_name
         FROM wishlists w
         JOIN products p ON p.id = w.product_id
         JOIN categories c ON c.id = p.category_id
         WHERE w.user_id = $1 AND p.active
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
