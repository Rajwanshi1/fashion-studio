import { describe, expect, it } from 'vitest';
import { formatINR } from '../lib/format';

describe('formatINR', () => {
  it('formats paise into en-IN grouped whole rupees', () => {
    expect(formatINR(18400000)).toBe('₹1,84,000');
    expect(formatINR(9600000)).toBe('₹96,000');
    expect(formatINR(32600000)).toBe('₹3,26,000');
  });

  it('drops decimals for .00 amounts', () => {
    expect(formatINR(250000)).toBe('₹2,500');
    expect(formatINR(0)).toBe('₹0');
  });

  it('keeps sub-rupee precision when present', () => {
    expect(formatINR(150)).toBe('₹1.5');
  });
});
