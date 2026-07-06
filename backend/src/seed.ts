import bcrypt from 'bcryptjs';
import { Pool } from 'pg';
import { createProductsRepo } from './data/products.repo';
import { createUsersRepo } from './data/users.repo';
import { ProductFlag } from './types';

// All product copy is drawn from design-reference/DESIGN-NOTES.md and the
// reference screens (Homepage/Collection/Search/PDP). Prices are integer paise.

const CATEGORIES = [
  {
    slug: 'lehenga-sets',
    name: 'Lehenga Sets',
    description: 'Hand-embroidered lehengas from The Verdant Edit — tissue, zardozi and sequin work, made to order in our Mumbai atelier.',
    position: 1,
  },
  {
    slug: 'jacket-sets',
    name: 'Jacket Sets',
    description: 'Structured jackets over fluid drapes — Indo-Western tailoring in celadon and sage.',
    position: 2,
  },
  {
    slug: 'gowns',
    name: 'Gowns',
    description: 'Draped and pleated gowns in tissue and organza, cut for movement.',
    position: 3,
  },
  {
    slug: 'anarkali',
    name: 'Anarkali',
    description: 'Floor-grazing anarkalis with fine threadwork and heritage silhouettes.',
    position: 4,
  },
  {
    slug: 'sharara-gharara',
    name: 'Sharara & Gharara',
    description: 'Festive shararas and ghararas with mirror and gota patti craft.',
    position: 5,
  },
];

interface SeedProduct {
  category: string;
  slug: string;
  name: string;
  price: number; // paise
  color: string;
  flag: ProductFlag;
  description: string;
  details: string;
}

const MTO_DETAILS =
  'Concealed side zip · cotton-silk lining\nDry clean only · handle embroidery with care\nMade to order in our Mumbai atelier · ships in 4–6 weeks';

// The first four are the homepage bestsellers, in creation order.
const PRODUCTS: SeedProduct[] = [
  {
    category: 'lehenga-sets',
    slug: 'sage-sequin-jacket-lehenga',
    name: 'Sage Sequin Jacket Lehenga',
    price: 18400000,
    color: 'Sage',
    flag: 'bestseller',
    description:
      'A hand-embroidered jacket lehenga in moss-sage tissue, scattered with matte sequins and fine zardozi along the hem. Structured shoulder, fluid drape — heritage craft cut for the way you actually move.',
    details: `Moss-sage tissue with matte hand-sequin & zardozi embroidery\nStructured jacket, A-line lehenga, matching draped dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'gowns',
    slug: 'moss-tissue-draped-gown',
    name: 'Moss Tissue Draped Gown',
    price: 9600000,
    color: 'Moss',
    flag: 'bestseller',
    description:
      'A single length of moss tissue draped into a floor-sweeping gown — softly sculpted at the shoulder, released into an easy bias fall. Quiet luxury for the evening that runs long.',
    details: `Moss tissue with hand-rolled edges\nDraped bodice, bias skirt, detachable trail\n${MTO_DETAILS}`,
  },
  {
    category: 'anarkali',
    slug: 'pistachio-threadwork-anarkali',
    name: 'Pistachio Threadwork Anarkali',
    price: 14200000,
    color: 'Pistachio',
    flag: 'bestseller',
    description:
      'Our karigars map fields of tonal threadwork across pistachio silk — an anarkali that moves like a whisper and photographs like a garden.',
    details: `Pistachio silk with tonal resham threadwork\nFull-flare anarkali, churidar and tissue dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'jacket-sets',
    slug: 'celadon-organza-cape-set',
    name: 'Celadon Organza Cape Set',
    price: 12800000,
    color: 'Celadon',
    flag: 'bestseller',
    description:
      'A translucent organza cape floats over a celadon column — sharp couture corners softened by air. Worn to be remembered, cut to be lived in.',
    details: `Celadon silk-organza cape with hand-finished hem\nColumn dress with concealed corsetry\n${MTO_DETAILS}`,
  },
  {
    category: 'lehenga-sets',
    slug: 'moss-tissue-mirror-lehenga',
    name: 'Moss Tissue Mirror Lehenga',
    price: 17200000,
    color: 'Moss',
    flag: null,
    description:
      'Hand-set mirrors catch the light across moss tissue — a festive lehenga that trades shine for shimmer.',
    details: `Moss tissue with hand-set mirror work\nA-line lehenga, fitted blouse, draped dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'lehenga-sets',
    slug: 'pistachio-zardozi-bridal-lehenga',
    name: 'Pistachio Zardozi Bridal Lehenga',
    price: 24800000,
    color: 'Pistachio',
    flag: 'new',
    description:
      'The atelier’s most intricate commission — 300 hours of zardozi over pistachio silk, a bridal lehenga in the Verdant Edit’s quietest register.',
    details: `Pistachio silk with dense gold zardozi and dabka\nBridal lehenga, corseted blouse, double dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'lehenga-sets',
    slug: 'eucalyptus-organza-cape-lehenga',
    name: 'Eucalyptus Organza Cape Lehenga',
    price: 19600000,
    color: 'Eucalyptus',
    flag: 'new',
    description:
      'An organza cape drifts over a eucalyptus lehenga — the modern bride’s answer to the dupatta, light as breath.',
    details: `Eucalyptus organza cape with tonal embroidery\nPanelled lehenga, sleeveless blouse\n${MTO_DETAILS}`,
  },
  {
    category: 'lehenga-sets',
    slug: 'forest-velvet-threadwork-lehenga',
    name: 'Forest Velvet Threadwork Lehenga',
    price: 21400000,
    color: 'Forest',
    flag: null,
    description:
      'Deep forest velvet grounded with fine threadwork — a winter-wedding lehenga with the weight of heirloom.',
    details: `Forest silk-velvet with resham threadwork\nFlared lehenga, long-sleeve blouse, velvet dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'lehenga-sets',
    slug: 'celadon-tissue-draped-lehenga',
    name: 'Celadon Tissue Draped Lehenga',
    price: 16800000,
    color: 'Celadon',
    flag: null,
    description:
      'A pre-draped celadon tissue lehenga — the ease of a sari, the architecture of couture.',
    details: `Celadon tissue with hand-pleated drape\nPre-draped lehenga, bustier blouse\n${MTO_DETAILS}`,
  },
  {
    category: 'lehenga-sets',
    slug: 'mint-mukaish-festive-lehenga',
    name: 'Mint Mukaish Festive Lehenga',
    price: 15200000,
    color: 'Mint',
    flag: 'bestseller',
    description:
      'Thousands of mukaish points hand-beaten into mint silk — a festive lehenga that glimmers like first light.',
    details: `Mint silk with silver mukaish work\nFlared lehenga, tie-back blouse, net dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'lehenga-sets',
    slug: 'sage-chikankari-light-lehenga',
    name: 'Sage Chikankari Light Lehenga',
    price: 13800000,
    color: 'Sage',
    flag: null,
    description:
      'Featherweight chikankari on sage mul — the lehenga for daytime mehendis and long golden hours.',
    details: `Sage mul-cotton with Lucknowi chikankari\nLight A-line lehenga, short blouse, organza dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'sharara-gharara',
    slug: 'eucalyptus-mirror-work-sharara',
    name: 'Eucalyptus Mirror-Work Sharara',
    price: 15600000,
    color: 'Eucalyptus',
    flag: null,
    description:
      'A wide-leg sharara in eucalyptus georgette, bordered with hand-set mirrors — made for dancing past midnight.',
    details: `Eucalyptus georgette with mirror-work borders\nSharara, short kurta, tissue dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'gowns',
    slug: 'fern-pleated-tissue-gown',
    name: 'Fern Pleated Tissue Gown',
    price: 11200000,
    color: 'Fern',
    flag: 'new',
    description:
      'Knife pleats of fern tissue open and close as you move — an architectural gown with a soft heart.',
    details: `Fern tissue, hand-pressed knife pleats\nPleated gown with sculpted shoulder\n${MTO_DETAILS}`,
  },
  {
    category: 'jacket-sets',
    slug: 'ivy-zardozi-jacket-set',
    name: 'Ivy Zardozi Jacket Set',
    price: 16400000,
    color: 'Ivy',
    flag: 'new',
    description:
      'A longline ivy jacket traced with zardozi vines over slim trousers — ceremony tailoring, Indo-Western at its core.',
    details: `Ivy raw silk with gold zardozi vinework\nLongline jacket, slim trousers\n${MTO_DETAILS}`,
  },
  {
    category: 'anarkali',
    slug: 'verdigris-silk-anarkali',
    name: 'Verdigris Silk Anarkali',
    price: 11800000,
    color: 'Verdigris',
    flag: null,
    description:
      'An unadorned verdigris silk anarkali cut on a heritage block — proof that restraint is the rarest craft.',
    details: `Verdigris silk, hand-finished seams\nClassic anarkali, churidar, plain dupatta\n${MTO_DETAILS}`,
  },
  {
    category: 'sharara-gharara',
    slug: 'jade-gota-patti-gharara',
    name: 'Jade Gota Patti Gharara',
    price: 14600000,
    color: 'Jade',
    flag: 'new',
    description:
      'Jade silk gharara edged in gota patti — festive craft from the old cities, tuned to the Verdant palette.',
    details: `Jade silk with gota patti borders\nGharara, kurti, net dupatta\n${MTO_DETAILS}`,
  },
];

const STANDARD_SIZES = ['XS', 'S', 'M', 'L', 'XL'];

export interface SeedOverrides {
  adminPassword?: string;
  customerPassword?: string;
}

/** Idempotent seed: catalog is skipped when any product exists; users are upsert-checked. */
export async function seed(pool: Pool, overrides: SeedOverrides = {}): Promise<boolean> {
  const USERS = [
    {
      email: 'admin@tanviagnihotry.com',
      password: overrides.adminPassword ?? 'TanviAdmin@2026',
      firstName: 'Tanvi',
      lastName: 'Agnihotry',
      role: 'admin' as const,
    },
    {
      email: 'aanya@example.com',
      password: overrides.customerPassword ?? 'Aanya@2026',
      firstName: 'Aanya',
      lastName: 'Mehra',
      role: 'customer' as const,
    },
  ];
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
      flag: p.flag,
      imageUrl: null,
      active: true,
      variants,
    });
  }

  return true;
}
