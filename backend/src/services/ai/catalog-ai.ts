// Catalog AI seam: colour-family mapping and SEO image naming.
//
// This file is the contract plus the deterministic half of the work — it must
// stay free of any Anthropic import so routes, fakes and tests can use the
// keyword map with no API key and no network. The Claude-backed implementation
// lives next door in ./catalog-ai-anthropic.ts.
//
// Both AI calls are best-effort by design: a colour that cannot be mapped is
// null (the shop filter simply misses that piece) and an image that cannot be
// named falls back to a uuid key. Nothing here or in the implementation throws.
import { ColorFamily } from '../../types';

/** Result of naming one product photo. `pose` is null when the model is unsure. */
export interface ImageNameResult {
  fileSlug: string;
  pose: string | null;
  /** Shopper-facing dominant garment colour, e.g. "Cherry Pink"; null when unsure. */
  colorName: string | null;
  /** Lowercase '#rrggbb' of that colour; null when unsure. */
  colorHex: string | null;
}

export interface CatalogAi {
  /** Maps free-text colour to a family; null when unmappable. Never throws. */
  colorFamily(colorText: string): Promise<ColorFamily | null>;
  /** SEO file slug + pose for a product photo; null on any failure. Never throws. */
  nameProductImage(
    image: { bytes: Uint8Array; mediaType: string },
    productName: string,
  ): Promise<ImageNameResult | null>;
}

/**
 * Ordered keyword map, first hit wins. Order matters where a phrase carries two
 * colour words: 'multi' outranks everything (a printed piece is multi-colour
 * whatever else is named), and pink is checked before red so "Cherry Pink" maps
 * to pink rather than red.
 */
const COLOR_KEYWORDS: ReadonlyArray<readonly [ColorFamily, readonly string[]]> = [
  ['multi', ['multi', 'multicolor', 'multi-color', 'ombre', 'print', 'printed']],
  ['orange-rust', ['orange', 'rust', 'terracotta', 'coral', 'peach']],
  ['yellow-gold', ['yellow', 'gold', 'mustard', 'amber', 'lemon', 'champagne']],
  ['pink', ['pink', 'rose', 'blush', 'fuchsia', 'magenta']],
  ['red', ['red', 'maroon', 'crimson', 'scarlet', 'wine', 'burgundy', 'cherry']],
  ['green', ['green', 'sage', 'moss', 'olive', 'emerald', 'mint', 'pistachio', 'celadon', 'eucalyptus', 'forest', 'fern']],
  ['blue', ['blue', 'navy', 'teal', 'turquoise', 'sapphire', 'indigo']],
  ['purple', ['purple', 'lavender', 'lilac', 'violet', 'plum', 'mauve']],
  ['white-ivory', ['white', 'ivory', 'cream', 'pearl', 'off-white', 'offwhite']],
  ['beige-nude', ['beige', 'nude', 'sand', 'tan']],
  ['brown', ['brown', 'chocolate', 'coffee', 'mocha', 'copper', 'bronze']],
  ['black', ['black', 'charcoal', 'onyx', 'jet']],
];

const RE_SPECIALS = /[.*+?^${}()|[\]\\]/g;

// One alternation per family, anchored on word boundaries so 'tan' does not fire
// inside "Titanium". Hyphenated keywords ('off-white') are safe: both ends are
// word characters, so \b still anchors them — and the hyphen itself is only
// special inside a character class, so escaping leaves it untouched.
const COLOR_PATTERNS: ReadonlyArray<readonly [ColorFamily, RegExp]> = COLOR_KEYWORDS.map(
  ([family, words]) =>
    [family, new RegExp(`\\b(?:${words.map((w) => w.replace(RE_SPECIALS, '\\$&')).join('|')})\\b`, 'i')] as const,
);

/** Deterministic colour mapping; null when no keyword matches. */
export function keywordColorFamily(colorText: string): ColorFamily | null {
  for (const [family, pattern] of COLOR_PATTERNS) {
    if (pattern.test(colorText)) return family;
  }
  return null;
}

/**
 * Keyword map first, AI only on a miss, null when no AI is configured. The
 * short-circuit is what keeps product saves instant for the common colours and
 * keeps the whole feature working with no ANTHROPIC_API_KEY.
 *
 * `ai` is nullable/optional so `deps.catalogAi` can be passed straight through.
 */
export async function resolveColorFamily(
  ai: CatalogAi | null | undefined,
  colorText: string,
): Promise<ColorFamily | null> {
  const text = colorText.trim();
  if (!text) return null;
  const hit = keywordColorFamily(text);
  if (hit) return hit;
  return (await ai?.colorFamily(text)) ?? null;
}
