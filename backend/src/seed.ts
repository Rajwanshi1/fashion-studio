import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { createProductsRepo } from './data/products.repo';
import { createUsersRepo } from './data/users.repo';
import { keywordColorFamily } from './services/ai/catalog-ai';
import { ProductFlag } from './types';

// All product copy is drawn from design-reference/DESIGN-NOTES.md and the
// reference screens (Homepage/Collection/Search/PDP). Prices are integer paise.

// Must match the rows installed by db/migrations/010_catalog_reset.sql —
// createCategory upserts by slug, so seed and reset agree.
const CATEGORIES = [
  {
    slug: 'kaftan',
    name: 'Kaftan',
    description: 'Fluid kaftans in tissue and organza — unhurried ease, cut for occasion.',
    position: 1,
  },
  {
    slug: 'anarkali',
    name: 'Anarkali',
    description: 'Floor-grazing anarkalis with fine threadwork and heritage silhouettes.',
    position: 2,
  },
  {
    slug: 'suits',
    name: 'Suits',
    description: 'Tailored suit sets — structured, hand-finished, made to order.',
    position: 3,
  },
  {
    slug: 'lehenga',
    name: 'Lehenga',
    description: 'Hand-embroidered lehengas — zardozi, mirror and sequin craft.',
    position: 4,
  },
  {
    slug: 'antifit',
    name: 'Antifit',
    description: 'Anti-fit silhouettes — architectural drape, unforced ease.',
    position: 5,
  },
];

interface SeedProduct {
  category: string;
  slug: string;
  name: string;
  price: number; // paise — base garment; add-ons priced separately below
  color: string;
  flag: ProductFlag;
  collection: string;
  craft: string;
  fabric: string;
  occasion: string;
  dupattaPrice: number | null;
  jacketPrice: number | null;
  description: string;
  details: string;
}

const MTO_DETAILS =
  'Concealed side zip · cotton-silk lining\nDry clean only · handle embroidery with care\nMade to order in our Jaipur atelier · ships in 4–6 weeks';

// Slugs follow the admin's auto-derive: slugify(`${name} ${color}`).
// The first four are the homepage bestsellers, in creation order.
const PRODUCTS: SeedProduct[] = [
  {
    category: 'lehenga',
    slug: 'zardozi-court-lehenga-sage',
    name: 'Zardozi Court Lehenga',
    price: 18400000,
    color: 'Sage',
    flag: 'bestseller',
    collection: 'The Verdant Edit',
    craft: 'Zardozi',
    fabric: 'Tissue',
    occasion: 'Wedding',
    dupattaPrice: 1200000,
    jacketPrice: null,
    description:
      'A hand-embroidered lehenga in moss-sage tissue, scattered with matte sequins and fine zardozi along the hem. Structured shoulder, fluid drape — heritage craft cut for the way you actually move.',
    details: `Moss-sage tissue with matte hand-sequin & zardozi embroidery\nA-line lehenga with matching draped dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'kaftan',
    slug: 'organza-trail-kaftan-celadon',
    name: 'Organza Trail Kaftan',
    price: 9600000,
    color: 'Celadon',
    flag: 'bestseller',
    collection: "Resort '26",
    craft: 'Hand-rolled edges',
    fabric: 'Organza',
    occasion: 'Cocktail',
    dupattaPrice: null,
    jacketPrice: null,
    description:
      'A translucent celadon kaftan with a floor-sweeping trail — softly sculpted at the shoulder, released into an easy bias fall. Quiet luxury for the evening that runs long.',
    details: `Celadon organza with hand-rolled edges\nTrailing kaftan, concealed side slits\n${MTO_DETAILS}`,
  },
  {
    category: 'anarkali',
    slug: 'threadwork-anarkali-pistachio',
    name: 'Threadwork Anarkali',
    price: 14200000,
    color: 'Pistachio',
    flag: 'bestseller',
    collection: 'Atelier Classics',
    craft: 'Resham threadwork',
    fabric: 'Silk',
    occasion: 'Reception',
    dupattaPrice: 800000,
    jacketPrice: null,
    description:
      'Our karigars map fields of tonal threadwork across pistachio silk — an anarkali that moves like a whisper and photographs like a garden.',
    details: `Pistachio silk with tonal resham threadwork\nFull-flare anarkali with churidar and tissue dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'suits',
    slug: 'zardozi-vine-suit-ivy',
    name: 'Zardozi Vine Suit',
    price: 16400000,
    color: 'Ivy',
    flag: 'bestseller',
    collection: 'Atelier Classics',
    craft: 'Zardozi',
    fabric: 'Raw silk',
    occasion: 'Wedding',
    dupattaPrice: 1000000,
    jacketPrice: 2000000,
    description:
      'A longline ivy suit traced with zardozi vines over slim trousers — ceremony tailoring, Indo-Western at its core.',
    details: `Ivy raw silk with gold zardozi vinework\nTailored kurta, slim trousers, optional longline jacket\n${MTO_DETAILS}`,
  },
  {
    category: 'lehenga',
    slug: 'mirror-bloom-lehenga-moss',
    name: 'Mirror Bloom Lehenga',
    price: 17200000,
    color: 'Moss',
    flag: null,
    collection: 'The Verdant Edit',
    craft: 'Mirror work',
    fabric: 'Tissue',
    occasion: 'Festive',
    dupattaPrice: 900000,
    jacketPrice: 2400000,
    description:
      'Hand-set mirrors catch the light across moss tissue — a festive lehenga that trades shine for shimmer.',
    details: `Moss tissue with hand-set mirror work\nA-line lehenga, fitted blouse, draped dupatta, optional jacket\n${MTO_DETAILS}`,
  },
  {
    category: 'lehenga',
    slug: 'bridal-zardozi-lehenga-pistachio',
    name: 'Bridal Zardozi Lehenga',
    price: 24800000,
    color: 'Pistachio',
    flag: 'new',
    collection: 'The Verdant Edit',
    craft: 'Zardozi & dabka',
    fabric: 'Silk',
    occasion: 'Wedding',
    dupattaPrice: 1500000,
    jacketPrice: null,
    description:
      'The atelier’s most intricate commission — 300 hours of zardozi over pistachio silk, a bridal lehenga in the Verdant Edit’s quietest register.',
    details: `Pistachio silk with dense gold zardozi and dabka\nBridal lehenga, corseted blouse, double dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'antifit',
    slug: 'pleated-drape-antifit-eucalyptus',
    name: 'Pleated Drape Antifit',
    price: 11200000,
    color: 'Eucalyptus',
    flag: 'new',
    collection: "Resort '26",
    craft: 'Hand-pleating',
    fabric: 'Georgette',
    occasion: 'Cocktail',
    dupattaPrice: null,
    jacketPrice: null,
    description:
      'Knife pleats of eucalyptus georgette open and close as you move — an architectural anti-fit silhouette with a soft heart.',
    details: `Eucalyptus georgette, hand-pressed knife pleats\nAnti-fit drape with sculpted shoulder\n${MTO_DETAILS}`,
  },
  {
    category: 'kaftan',
    slug: 'mukaish-dusk-kaftan-mint',
    name: 'Mukaish Dusk Kaftan',
    price: 12800000,
    color: 'Mint',
    flag: null,
    collection: 'Festive Edit',
    craft: 'Mukaish',
    fabric: 'Silk',
    occasion: 'Festive',
    dupattaPrice: null,
    jacketPrice: null,
    description:
      'Thousands of mukaish points hand-beaten into mint silk — a kaftan that glimmers like first light.',
    details: `Mint silk with silver mukaish work\nFluid kaftan with tie-back detail\n${MTO_DETAILS}`,
  },
  {
    category: 'suits',
    slug: 'chikankari-day-suit-sage',
    name: 'Chikankari Day Suit',
    price: 13800000,
    color: 'Sage',
    flag: null,
    collection: 'Festive Edit',
    craft: 'Chikankari',
    fabric: 'Mul cotton',
    occasion: 'Festive',
    dupattaPrice: 0,
    jacketPrice: null,
    description:
      'Featherweight Lucknowi chikankari on sage mul — the suit for daytime mehendis and long golden hours. Organza dupatta included with our compliments.',
    details: `Sage mul-cotton with Lucknowi chikankari\nStraight kurta, tapered trousers, organza dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'antifit',
    slug: 'boxy-jacket-antifit-fern',
    name: 'Boxy Jacket Antifit',
    price: 11800000,
    color: 'Fern',
    flag: 'new',
    collection: "Resort '26",
    craft: 'Hand-finished seams',
    fabric: 'Tissue',
    occasion: 'Cocktail',
    dupattaPrice: null,
    jacketPrice: 0,
    description:
      'A boxy jacket floats over an anti-fit fern column — sharp couture corners softened by air. The jacket comes included; wear it or hand it to the evening.',
    details: `Fern tissue with hand-finished seams\nAnti-fit column with boxy jacket\n${MTO_DETAILS}`,
  },
  {
    category: 'anarkali',
    slug: 'heritage-silk-anarkali-verdigris',
    name: 'Heritage Silk Anarkali',
    price: 11800000,
    color: 'Verdigris',
    flag: null,
    collection: 'Atelier Classics',
    craft: 'Hand-finished seams',
    fabric: 'Silk',
    occasion: 'Reception',
    dupattaPrice: 700000,
    jacketPrice: null,
    description:
      'An unadorned verdigris silk anarkali cut on a heritage block — proof that restraint is the rarest craft.',
    details: `Verdigris silk, hand-finished seams\nClassic anarkali, churidar, plain dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'lehenga',
    slug: 'gota-patti-lehenga-jade',
    name: 'Gota Patti Lehenga',
    price: 14600000,
    color: 'Jade',
    flag: 'new',
    collection: 'Festive Edit',
    craft: 'Gota patti',
    fabric: 'Silk',
    occasion: 'Festive',
    dupattaPrice: 800000,
    jacketPrice: null,
    description:
      'Jade silk edged in gota patti — festive craft from the old cities, tuned to the Verdant palette.',
    details: `Jade silk with gota patti borders\nFlared lehenga, kurti blouse, net dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'kaftan',
    slug: 'tissue-column-kaftan-fern',
    name: 'Tissue Column Kaftan',
    price: 9900000,
    color: 'Fern',
    flag: null,
    collection: "Resort '26",
    craft: 'Hand-rolled edges',
    fabric: 'Tissue',
    occasion: 'Reception',
    dupattaPrice: null,
    jacketPrice: null,
    description:
      'A fern tissue column cut with kaftan ease — the piece you reach for when the invitation says elegant but the weather says otherwise.',
    details: `Fern tissue with hand-rolled edges\nColumn kaftan with concealed side zip\n${MTO_DETAILS}`,
  },
];

const STANDARD_SIZES = ['XS', 'S', 'M', 'L', 'XL'];

export interface SeedOverrides {
  adminPassword?: string;
  customerPassword?: string;
  /** false skips the demo customer (prod seeds the admin only). */
  demoCustomer?: boolean;
}

/** Idempotent seed: catalog is skipped when any product exists; users are upsert-checked. */
export async function seed(pool: Pool, overrides: SeedOverrides = {}): Promise<boolean> {
  const USERS: Array<{
    email: string;
    password: string;
    firstName: string;
    lastName: string;
    role: 'admin' | 'customer';
  }> = [
    {
      email: 'admin@tanviagnihotry.com',
      password: overrides.adminPassword ?? 'TanviAdmin@2026',
      firstName: 'Tanvi',
      lastName: 'Agnihotry',
      role: 'admin' as const,
    },
  ];
  if (overrides.demoCustomer !== false) {
    USERS.push({
      email: 'aanya@example.com',
      password: overrides.customerPassword ?? 'Aanya@2026',
      firstName: 'Aanya',
      lastName: 'Mehra',
      role: 'customer' as const,
    });
  }
  const products = createProductsRepo(pool);
  const users = createUsersRepo(pool);

  for (const u of USERS) {
    if (!(await users.findByEmail(u.email))) {
      const passwordHash = await bcrypt.hash(u.password, 10);
      await users.create({ email: u.email, passwordHash, firstName: u.firstName, lastName: u.lastName, role: u.role });
    }
  }

  if ((await products.listAllProducts()).length > 0) return false;

  const categoryIds = new Map<string, string>();
  for (const c of CATEGORIES) {
    const created = await products.createCategory(c);
    categoryIds.set(created.slug, created.id);
  }

  for (const [i, p] of PRODUCTS.entries()) {
    const variants = STANDARD_SIZES.map((size, s) => ({ size, stock: 2 + ((i * 5 + s * 3) % 7) }));
    variants.push({ size: 'Custom', stock: 50 });
    await products.createProduct({
      categoryId: categoryIds.get(p.category)!,
      slug: p.slug,
      name: p.name,
      description: p.description,
      details: p.details,
      price: p.price,
      color: p.color,
      // Fresh DBs get a filled-in shop filter; live rows stay NULL until saved.
      colorFamily: keywordColorFamily(p.color),
      flag: p.flag,
      imageUrl: null,
      active: true,
      collection: p.collection,
      craft: p.craft,
      fabric: p.fabric,
      occasion: p.occasion,
      dupattaPrice: p.dupattaPrice,
      jacketPrice: p.jacketPrice,
      variants,
    });
  }

  return true;
}
