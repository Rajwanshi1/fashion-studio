// Deterministic colour-name → family mapping for swatch fills.
//
// Keyword map hand-mirrored from backend/src/services/ai/catalog-ai.ts — keep
// in sync. Order matters where a phrase carries two colour words: 'multi'
// outranks everything (a printed piece is multi-colour whatever else is
// named), and pink is checked before red so "Cherry Pink" maps to pink rather
// than red.
import { COLOR_FAMILY_META } from './types';
import type { ColorFamily } from './types';

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
 * Swatch background for a photo colour: the photo's own hex when present,
 * else the keyword family's swatch, else null (caller falls back to the
 * `.c-default` class).
 */
export function swatchFill(name: string, hex: string): string | null {
  if (hex) return hex;
  const family = keywordColorFamily(name);
  return family ? COLOR_FAMILY_META[family].swatch : null;
}
