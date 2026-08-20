import { Pool, PoolClient } from 'pg';
import { withTransaction } from '../db';
import {
  Category,
  ColorFamily,
  DomainError,
  ProductComponent,
  ProductDetail,
  ProductFilter,
  ProductFlag,
  ProductImage,
  ProductSummary,
  Tx,
  Variant,
} from '../types';

/** Product detail plus fields the admin app and related-lookup need. */
export interface AdminProduct extends ProductDetail {
  categoryId: string;
  createdAt: string;
  /** Paise; admin-only — stripped before any storefront response. */
  costPrice: number | null;
}

/** Variant joined with product pricing info, read under row lock at order time. */
export interface VariantForOrder {
  id: string;
  productId: string;
  size: string;
  stock: number;
  productName: string;
  color: string;
  /** Base garment price; kept optional component prices are added per line. */
  unitPrice: number;
  imageUrl: string | null;
  /** The product's set, in display order — checkout prices the kept optional rows. */
  components: { name: string; optional: boolean; price: number | null }[];
  /** Whether a custom-colour request may be priced (+₹1,000) on this piece. */
  customColorAvailable: boolean;
}

export interface CreateCategoryInput {
  slug: string;
  name: string;
  description: string;
  position: number;
}

/** One gallery photo on the way in; the tag fields default to '' when the AI is unsure. */
export interface ProductImageInput {
  url: string;
  pose?: string;
  color?: string;
  colorHex?: string;
}

/** One set piece on the way in; `price` is only kept on optional rows. */
export interface ProductComponentInput {
  name: string;
  optional?: boolean;
  price?: number | null;
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
  /** Discounted BASE price; only meaningful alongside flag 'sale'. */
  salePrice?: number | null;
  /** Admin-only cost of the piece. */
  costPrice?: number | null;
  /** Resolved by the route (keyword map, AI on a miss) — never sent by clients. */
  colorFamily?: ColorFamily | null;
  /** Ordered gallery; when present it also sets image_url to images[0].url. */
  images?: ProductImageInput[];
  /** "This order contains" rows, in display order. */
  components?: ProductComponentInput[];
  /** Absent = available — every garment can be re-dyed unless opted out. */
  customColorAvailable?: boolean;
  variants?: { size: string; stock: number }[];
}

export interface UpdateProductInput {
  categoryId?: string;
  name?: string;
  /** Renaming a piece's slug records the outgoing slug in product_slug_aliases,
   *  so every live /product/:slug link keeps resolving. */
  slug?: string;
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
  salePrice?: number | null;
  costPrice?: number | null;
  colorFamily?: ColorFamily | null;
  customColorAvailable?: boolean;
  /** Provenance — optional; '' / null clears a field. */
  karigarName?: string;
  hoursWorked?: number | null;
  techniques?: string;
  finishedOn?: string | null;
  /** Absent leaves the gallery untouched; present replaces it wholesale. */
  images?: ProductImageInput[];
  /** Absent leaves the set untouched; present replaces it wholesale. */
  components?: ProductComponentInput[];
}

/** Per-id outcome of a bulk delete: ordered products are archived, the rest removed. */
export interface BulkDeleteResult {
  deleted: string[];
  archived: string[];
}

/** A merchandising edit applied to a whole selection at once. */
export type BulkProductAction =
  /** Discount off each piece's own list price — never off a price already discounted. */
  | { type: 'sale'; discountPct: number }
  | { type: 'end_sale' }
  | { type: 'visibility'; active: boolean }
  | { type: 'flag'; flag: 'new' | 'bestseller' | null };

/** `skipped` = the piece exists but the action did not apply to it (see bulkUpdate). */
export interface BulkUpdateResult {
  updated: string[];
  skipped: string[];
  notFound: string[];
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
  bulkUpdate(ids: string[], action: BulkProductAction): Promise<BulkUpdateResult>;
}

export interface WishlistRepo {
  list(userId: string): Promise<ProductSummary[]>;
  add(userId: string, productId: string): Promise<void>;
  remove(userId: string, productId: string): Promise<void>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DEFAULT_SIZES = ['XS', 'S', 'M', 'L', 'XL', 'Custom'];

/** Default-included add-ons: the optional priced component rows, summed. */
const ADDONS_TOTAL_SQL = `COALESCE((SELECT SUM(pc.price) FROM product_components pc
  WHERE pc.product_id = p.id AND pc.optional), 0)`;

const SUMMARY_SELECT = `
  SELECT p.id, p.slug, p.name, p.price, p.color, p.flag, p.image_url,
         p.collection, p.occasion, p.sale_price, p.color_family,
         (${ADDONS_TOTAL_SQL}) AS addons_total,
         c.slug AS category_slug, c.name AS category_name
  FROM products p JOIN categories c ON c.id = p.category_id`;

const DETAIL_SELECT = `
  SELECT p.*, (${ADDONS_TOTAL_SQL}) AS addons_total,
         c.slug AS category_slug, c.name AS category_name
  FROM products p JOIN categories c ON c.id = p.category_id`;

/**
 * The base price actually charged: the sale price when the piece is on sale,
 * the list price otherwise. This is the ONE place the discount lives — price
 * sorts and getVariantsForUpdate (i.e. checkout) both read it, so the shop can
 * never display a sale price and charge full price.
 */
const EFFECTIVE_PRICE = `CASE WHEN p.flag = 'sale' AND p.sale_price IS NOT NULL THEN p.sale_price ELSE p.price END`;

// Price sorts use the full-set price (effective base + default-included add-ons)
// so the order matches the price shoppers see on the cards.
const ORDER_BY: Record<string, string> = {
  featured: `(p.flag = 'bestseller') IS TRUE DESC, (p.flag = 'new') IS TRUE DESC, p.created_at ASC`,
  new: 'p.created_at DESC',
  price_asc: `((${EFFECTIVE_PRICE}) + (${ADDONS_TOTAL_SQL})) ASC`,
  price_desc: `((${EFFECTIVE_PRICE}) + (${ADDONS_TOTAL_SQL})) DESC`,
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
    addonsTotal: Number(row.addons_total ?? 0),
    colorFamily: row.color_family ?? null,
    salePrice: row.sale_price ?? null,
  };
}

function mapVariant(row: any): Variant {
  return { id: row.id, productId: row.product_id, size: row.size, stock: row.stock };
}

function mapImage(row: any): ProductImage {
  return { url: row.url, pose: row.pose ?? '', color: row.color ?? '', colorHex: row.color_hex ?? '' };
}

function mapComponent(row: any): ProductComponent {
  return { id: row.id, name: row.name, optional: row.optional, price: row.price ?? null };
}

function mapDetail(
  row: any,
  variants: Variant[],
  images: ProductImage[],
  components: ProductComponent[],
): AdminProduct {
  return {
    ...mapSummary(row),
    description: row.description,
    details: row.details,
    craft: row.craft ?? '',
    fabric: row.fabric ?? '',
    active: row.active,
    variants,
    images,
    components,
    customColorAvailable: row.custom_color_available,
    categoryId: row.category_id,
    createdAt: row.created_at.toISOString(),
    costPrice: row.cost_price ?? null,
    karigarName: row.karigar_name ?? '',
    hoursWorked: row.hours_worked ?? null,
    techniques: row.techniques ?? '',
    // date → 'YYYY-MM-DD'. pg hands DATE columns back as a LOCAL-midnight Date,
    // so toISOString() would shift it a day west of UTC — format locally.
    finishedOn:
      row.finished_on instanceof Date
        ? [
            row.finished_on.getFullYear(),
            String(row.finished_on.getMonth() + 1).padStart(2, '0'),
            String(row.finished_on.getDate()).padStart(2, '0'),
          ].join('-')
        : (row.finished_on ?? null),
  };
}

/**
 * A bulk discount in SQL. `price` is paise, so `/ 10000` takes the discounted
 * amount down to rupees and `* 100` returns it to paise — i.e. the sale price
 * is rounded to the nearest whole rupee. $1 is the id array, $2 the percentage.
 */
const BULK_SALE_PRICE = `(round(price * (100 - $2)::numeric / 10000) * 100)::int`;

/**
 * The single statement a bulk action runs. Every branch is scoped to live
 * products and returns the ids it actually touched, so the caller can tell an
 * applied edit from a skipped one without a second read.
 */
function bulkUpdateSql(action: BulkProductAction, ids: string[]): [string, unknown[]] {
  const scope = 'WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL';
  switch (action.type) {
    case 'sale':
      // The guard is the same invariant the create/update routes enforce
      // (0 < sale_price < price). A piece too cheap for the discount to move it
      // a whole rupee is skipped rather than failing the whole batch.
      return [
        `UPDATE products SET flag = 'sale', sale_price = ${BULK_SALE_PRICE}
         ${scope} AND ${BULK_SALE_PRICE} BETWEEN 1 AND price - 1
         RETURNING id`,
        [ids, action.discountPct],
      ];
    case 'end_sale':
      // Scoped to pieces actually on sale, so ending a sale can never strip a
      // 'bestseller' off an unrelated piece caught in the same selection.
      return [
        `UPDATE products SET flag = NULL, sale_price = NULL
         ${scope} AND flag = 'sale'
         RETURNING id`,
        [ids],
      ];
    case 'visibility':
      return [`UPDATE products SET active = $2 ${scope} RETURNING id`, [ids, action.active]];
    case 'flag':
      // Leaving the sale clears the discount — getVariantsForUpdate charges the
      // effective price, so a stale sale_price is a money bug, not cosmetics.
      return [
        `UPDATE products SET flag = $2, sale_price = NULL ${scope} RETURNING id`,
        [ids, action.flag],
      ];
  }
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

  /** Galleries for a batch of products, in display order — mirrors loadVariants. */
  async function loadImages(client: Pool | PoolClient, productIds: string[]): Promise<Map<string, ProductImage[]>> {
    const byProduct = new Map<string, ProductImage[]>();
    if (productIds.length === 0) return byProduct;
    const { rows } = await client.query(
      `SELECT product_id, url, pose, color, color_hex FROM product_images
       WHERE product_id = ANY($1::uuid[]) ORDER BY position, id`,
      [productIds],
    );
    for (const row of rows) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push(mapImage(row));
      byProduct.set(row.product_id, list);
    }
    return byProduct;
  }

  /** Replaces a product's gallery wholesale; position = array index. */
  async function replaceImages(client: PoolClient, productId: string, images: ProductImageInput[]): Promise<void> {
    await client.query('DELETE FROM product_images WHERE product_id = $1', [productId]);
    for (const [position, image] of images.entries()) {
      await client.query(
        'INSERT INTO product_images (product_id, url, position, pose, color, color_hex) VALUES ($1, $2, $3, $4, $5, $6)',
        [productId, image.url, position, image.pose ?? '', image.color ?? '', image.colorHex ?? ''],
      );
    }
  }

  /** Set pieces for a batch of products, in display order — mirrors loadImages. */
  async function loadComponents(
    client: Pool | PoolClient,
    productIds: string[],
  ): Promise<Map<string, ProductComponent[]>> {
    const byProduct = new Map<string, ProductComponent[]>();
    if (productIds.length === 0) return byProduct;
    const { rows } = await client.query(
      `SELECT id, product_id, name, optional, price FROM product_components
       WHERE product_id = ANY($1::uuid[]) ORDER BY position, id`,
      [productIds],
    );
    for (const row of rows) {
      const list = byProduct.get(row.product_id) ?? [];
      list.push(mapComponent(row));
      byProduct.set(row.product_id, list);
    }
    return byProduct;
  }

  /** Replaces a product's set wholesale; position = array index. */
  async function replaceComponents(
    client: PoolClient,
    productId: string,
    components: ProductComponentInput[],
  ): Promise<void> {
    await client.query('DELETE FROM product_components WHERE product_id = $1', [productId]);
    for (const [position, component] of components.entries()) {
      await client.query(
        'INSERT INTO product_components (product_id, name, optional, price, position) VALUES ($1, $2, $3, $4, $5)',
        // Price is only meaningful on optional rows — a required piece's cost
        // lives in the base price, so it is normalized away here. An optional
        // row is ALWAYS priced (blank = 0, included free): the PDP renders a
        // checkbox only for priced optional rows, so a null here would promise
        // "customer can remove it" in admin and never let the customer do so.
        [
          productId,
          component.name,
          component.optional ?? false,
          component.optional ? (component.price ?? 0) : null,
          position,
        ],
      );
    }
  }

  async function getById(client: Pool | PoolClient, id: string): Promise<AdminProduct | null> {
    if (!UUID_RE.test(id)) return null;
    const { rows } = await client.query(`${DETAIL_SELECT} WHERE p.id = $1`, [id]);
    if (!rows[0]) return null;
    const [variants, images, components] = await Promise.all([
      loadVariants(client, [id]),
      loadImages(client, [id]),
      loadComponents(client, [id]),
    ]);
    return mapDetail(rows[0], variants.get(id) ?? [], images.get(id) ?? [], components.get(id) ?? []);
  }

  return {
    async listCategories() {
      const { rows } = await pool.query(
        // The soft-delete gate has to match listProducts, or an archived piece
        // inflates the sidebar badge and the count disagrees with the grid.
        `SELECT c.*, COUNT(p.id) FILTER (WHERE p.active AND p.deleted_at IS NULL) AS product_count
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
      if (filter.colorFamily) {
        params.push(filter.colorFamily);
        where.push(`p.color_family = $${params.length}`);
      }
      if (filter.search) {
        // Tokenized: every word must hit one of the descriptive columns, so
        // "sage lehenga" finds a sage piece filed under the Lehenga category.
        for (const token of filter.search.split(/\s+/).filter(Boolean)) {
          params.push(`%${token}%`);
          const p = `$${params.length}`;
          where.push(
            `(p.name ILIKE ${p} OR p.description ILIKE ${p} OR p.color ILIKE ${p}
              OR p.craft ILIKE ${p} OR p.fabric ILIKE ${p} OR p.occasion ILIKE ${p} OR c.name ILIKE ${p})`,
          );
        }
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
      let { rows } = await pool.query(`${DETAIL_SELECT} WHERE p.slug = $1 AND p.deleted_at IS NULL`, [slug]);
      if (!rows[0]) {
        // Renamed pieces answer to their old slugs too. The payload's `slug`
        // is the current one, so the storefront can canonicalise the URL.
        ({ rows } = await pool.query(
          `${DETAIL_SELECT} JOIN product_slug_aliases a ON a.product_id = p.id
           WHERE a.old_slug = $1 AND p.deleted_at IS NULL`,
          [slug],
        ));
      }
      if (!rows[0]) return null;
      const id = rows[0].id;
      const [variants, images, components] = await Promise.all([
        loadVariants(pool, [id]),
        loadImages(pool, [id]),
        loadComponents(pool, [id]),
      ]);
      return mapDetail(rows[0], variants.get(id) ?? [], images.get(id) ?? [], components.get(id) ?? []);
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
      // unit_price is the EFFECTIVE base price: a piece on sale is charged at
      // its sale price, and every caller (cart, checkout, order snapshot) gets
      // that number for free.
      // Components ride in the SAME statement as the locked price read: a
      // second SELECT would use a later READ COMMITTED snapshot, so an admin
      // save landing between the two could price a line from the old base
      // price plus the new components — a total no committed product ever had.
      const { rows } = await client.query(
        `SELECT v.id, v.product_id, v.size, v.stock,
                p.name AS product_name, p.color, ${EFFECTIVE_PRICE} AS unit_price, p.image_url,
                p.custom_color_available,
                COALESCE((SELECT json_agg(json_build_object('name', pc.name, 'optional', pc.optional, 'price', pc.price)
                                          ORDER BY pc.position, pc.id)
                          FROM product_components pc WHERE pc.product_id = p.id), '[]'::json) AS components
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
        components: (row.components as { name: string; optional: boolean; price: number | null }[]) ?? [],
        customColorAvailable: row.custom_color_available,
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
                                   collection, craft, fabric, occasion, sale_price, cost_price, color_family,
                                   custom_color_available)
             VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18) RETURNING id`,
            [
              input.categoryId,
              input.slug,
              input.name,
              input.description ?? '',
              input.details ?? '',
              input.price,
              input.color ?? '',
              input.flag ?? null,
              // A gallery always owns the primary photo (images[0]); the legacy
              // single imageUrl only applies when no gallery was sent.
              input.images ? (input.images[0]?.url ?? null) : (input.imageUrl ?? null),
              // New pieces start hidden unless explicitly published — a
              // half-finished piece must never appear on the boutique.
              input.active ?? false,
              input.collection ?? '',
              input.craft ?? '',
              input.fabric ?? '',
              input.occasion ?? '',
              input.salePrice ?? null,
              input.costPrice ?? null,
              input.colorFamily ?? null,
              input.customColorAvailable ?? true,
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
        if (input.images) await replaceImages(client, productId, input.images);
        if (input.components) await replaceComponents(client, productId, input.components);
        return productId;
      });
      return (await getById(pool, id))!;
    },

    async updateProduct(id, input) {
      if (!UUID_RE.test(id)) return null;
      const columns: Record<string, string> = {
        categoryId: 'category_id',
        name: 'name',
        slug: 'slug',
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
        salePrice: 'sale_price',
        costPrice: 'cost_price',
        colorFamily: 'color_family',
        customColorAvailable: 'custom_color_available',
        karigarName: 'karigar_name',
        hoursWorked: 'hours_worked',
        techniques: 'techniques',
        finishedOn: 'finished_on',
      };
      // A gallery in the payload also re-points the denormalized primary photo.
      const patch: UpdateProductInput = input.images
        ? { ...input, imageUrl: input.images[0]?.url ?? null }
        : input;
      const sets: string[] = [];
      const params: unknown[] = [id];
      for (const [key, column] of Object.entries(columns)) {
        const value = (patch as Record<string, unknown>)[key];
        if (value !== undefined) {
          params.push(value);
          sets.push(`${column} = $${params.length}`);
        }
      }
      const hasChildLists = patch.images !== undefined || patch.components !== undefined;
      if (sets.length === 0 && !hasChildLists) return getById(pool, id);
      const updateSql = `UPDATE products SET ${sets.join(', ')} WHERE id = $1`;
      let rowCount: number | null;
      try {
        if (!hasChildLists && patch.slug === undefined) {
          ({ rowCount } = await pool.query(updateSql, params));
        } else {
          // Child-list replacement / slug rename and the row update land
          // together or not at all.
          rowCount = await withTransaction(pool, async (client) => {
            if (patch.slug !== undefined) {
              const cur = await client.query('SELECT slug FROM products WHERE id = $1 FOR UPDATE', [id]);
              if (!cur.rowCount) return 0;
              const oldSlug: string = cur.rows[0].slug;
              if (oldSlug !== patch.slug) {
                // The outgoing slug becomes an alias of this piece, so every
                // link ever shared keeps resolving. Aliases carry the product
                // id, never another slug — no chains to walk or break.
                await client.query(
                  `INSERT INTO product_slug_aliases (old_slug, product_id) VALUES ($1, $2)
                   ON CONFLICT (old_slug) DO UPDATE SET product_id = EXCLUDED.product_id`,
                  [oldSlug, id],
                );
                // Renaming to a slug that is currently someone's alias: the
                // live slug wins, the alias row is reclaimed.
                await client.query('DELETE FROM product_slug_aliases WHERE old_slug = $1', [patch.slug]);
              }
            }
            const res = sets.length
              ? await client.query(updateSql, params)
              : await client.query('SELECT 1 FROM products WHERE id = $1', [id]);
            if (!res.rowCount) return 0;
            if (patch.images !== undefined) await replaceImages(client, id, patch.images);
            if (patch.components !== undefined) await replaceComponents(client, id, patch.components);
            return res.rowCount;
          });
        }
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
      const ids = rows.map((r) => r.id);
      const [variants, images, components] = await Promise.all([
        loadVariants(pool, ids),
        loadImages(pool, ids),
        loadComponents(pool, ids),
      ]);
      return rows.map((row) =>
        mapDetail(row, variants.get(row.id) ?? [], images.get(row.id) ?? [], components.get(row.id) ?? []),
      );
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

    async bulkUpdate(ids, action) {
      const valid = ids.filter((id) => UUID_RE.test(id));
      if (valid.length === 0) return { updated: [], skipped: [], notFound: ids };
      return withTransaction(pool, async (client) => {
        // Which ids exist at all, read first so a piece the action declined to
        // touch ('skipped') is never confused with one that isn't there.
        const { rows: liveRows } = await client.query(
          'SELECT id FROM products WHERE id = ANY($1::uuid[]) AND deleted_at IS NULL',
          [valid],
        );
        const live = new Set(liveRows.map((r) => r.id as string));
        const [sql, params] = bulkUpdateSql(action, valid);
        const { rows } = await client.query(sql, params);
        const updated = rows.map((r) => r.id as string);
        const touched = new Set(updated);
        return {
          updated,
          skipped: [...live].filter((id) => !touched.has(id)),
          notFound: ids.filter((id) => !live.has(id)),
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
                p.collection, p.occasion, p.sale_price, p.color_family,
                (${ADDONS_TOTAL_SQL}) AS addons_total,
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
