import { describe, expect, it } from 'vitest';
import { keywordColorFamily, swatchFill } from '../lib/colors';
import { COLOR_FAMILY_META } from '../lib/types';

describe('keywordColorFamily', () => {
  it('maps couture greens to the green family', () => {
    expect(keywordColorFamily('Moss')).toBe('green');
    expect(keywordColorFamily('Deep Forest')).toBe('green');
  });

  it('checks pink before red: "Cherry Pink" is pink, not red', () => {
    expect(keywordColorFamily('Cherry Pink')).toBe('pink');
  });

  it('multi outranks every other colour word in the phrase', () => {
    expect(keywordColorFamily('Printed Rose')).toBe('multi');
    expect(keywordColorFamily('Sage Ombre')).toBe('multi');
  });

  it('matches whole words only — "tan" must not fire inside "Titanium"', () => {
    expect(keywordColorFamily('Titanium')).toBeNull();
  });

  it('returns null when no keyword matches', () => {
    expect(keywordColorFamily('Monsoon Sky')).toBeNull();
  });
});

describe('swatchFill', () => {
  it('prefers the photo hex when present', () => {
    expect(swatchFill('Moss', '#7c9a8c')).toBe('#7c9a8c');
  });

  it('falls back to the keyword family swatch on an empty hex', () => {
    expect(swatchFill('Moss', '')).toBe(COLOR_FAMILY_META.green.swatch);
  });

  it('is null when neither hex nor keyword resolves', () => {
    expect(swatchFill('Monsoon Sky', '')).toBeNull();
  });
});
