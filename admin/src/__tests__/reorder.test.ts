import { describe, expect, it } from 'vitest';
import { dropIndexForPoint, moveItem, slotToIndex } from '../lib/reorder';
import type { Rect } from '../lib/reorder';

describe('moveItem', () => {
  it('splice-moves forward: dragging 0 to 3 shifts 1–3 left', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 0, 3)).toEqual(['b', 'c', 'd', 'a']);
  });

  it('splice-moves backward: dragging 3 to 0 shifts 0–2 right', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 3, 0)).toEqual(['d', 'a', 'b', 'c']);
  });

  it('moves a middle item without touching the rest of the order', () => {
    expect(moveItem(['a', 'b', 'c', 'd'], 1, 2)).toEqual(['a', 'c', 'b', 'd']);
  });

  it('same-index move and out-of-bounds indices return the list unchanged', () => {
    const list = ['a', 'b', 'c'];
    expect(moveItem(list, 1, 1)).toBe(list);
    expect(moveItem(list, -1, 2)).toBe(list);
    expect(moveItem(list, 0, 3)).toBe(list);
  });
});

describe('dropIndexForPoint', () => {
  // Two wrapped rows of three 100×140 thumbs with a 10px gap:
  // row 1 at y=0, row 2 at y=150.
  const grid: Rect[] = [
    { left: 0, top: 0, width: 100, height: 140 },
    { left: 110, top: 0, width: 100, height: 140 },
    { left: 220, top: 0, width: 100, height: 140 },
    { left: 0, top: 150, width: 100, height: 140 },
    { left: 110, top: 150, width: 100, height: 140 },
    { left: 220, top: 150, width: 100, height: 140 },
  ];

  it('slots by horizontal midpoint within the pointed-at row', () => {
    expect(dropIndexForPoint(grid, 30, 70)).toBe(0); // left of thumb 0's midpoint
    expect(dropIndexForPoint(grid, 90, 70)).toBe(1); // right of thumb 0's midpoint
    expect(dropIndexForPoint(grid, 300, 70)).toBe(3); // past the last midpoint of row 1
  });

  it('picks the nearest row band vertically', () => {
    expect(dropIndexForPoint(grid, 130, 220)).toBe(4); // mid row 2
    expect(dropIndexForPoint(grid, 30, 146)).toBe(3); // in the row gap, closer to row 2
  });

  it('left of a row inserts at the row start; below all rows appends', () => {
    expect(dropIndexForPoint(grid, -20, 220)).toBe(3);
    expect(dropIndexForPoint(grid, 150, 400)).toBe(6);
  });

  it('empty grid always slots at 0', () => {
    expect(dropIndexForPoint([], 50, 50)).toBe(0);
  });
});

describe('slotToIndex', () => {
  it('slots past the dragged item shift down by one', () => {
    expect(slotToIndex(3, 0)).toBe(2);
    expect(slotToIndex(4, 0)).toBe(3);
  });

  it('slots at or before the dragged item map directly', () => {
    expect(slotToIndex(0, 3)).toBe(0);
    expect(slotToIndex(3, 3)).toBe(3);
  });

  it('the two no-op zones both resolve to the source index', () => {
    expect(slotToIndex(2, 2)).toBe(2); // dropping right before itself
    expect(slotToIndex(3, 2)).toBe(2); // dropping right after itself
  });
});
