// Pure drag-and-drop reorder logic for the product photo strip.
// Kept free of DOM access so it unit-tests with synthetic rects —
// jsdom's getBoundingClientRect is all zeros.

export interface Rect {
  left: number;
  top: number;
  width: number;
  height: number;
}

/** Splice-move: remove `from`, insert at `to` (final resting index). */
export function moveItem<T>(list: T[], from: number, to: number): T[] {
  if (from === to || from < 0 || from >= list.length || to < 0 || to >= list.length) return list;
  const next = [...list];
  const [item] = next.splice(from, 1);
  next.splice(to, 0, item);
  return next;
}

/**
 * 2-D insertion slot 0..n for a pointer at (x, y) over a wrapped grid.
 * Rects are in DOM order; a wrap (left not increasing) starts a new row.
 * Row first — nearest row band by vertical centre; then within that row,
 * slot by x vs each member's horizontal midpoint. Below all rows → n.
 */
export function dropIndexForPoint(rects: Rect[], x: number, y: number): number {
  if (rects.length === 0) return 0;

  const rows: number[][] = [];
  for (let i = 0; i < rects.length; i++) {
    const row = rows[rows.length - 1];
    if (!row || rects[i].left <= rects[row[row.length - 1]].left) rows.push([i]);
    else row.push(i);
  }

  const lastRowRect = rects[rows[rows.length - 1][0]];
  if (y > lastRowRect.top + lastRowRect.height) return rects.length;

  let best = rows[0];
  let bestDist = Infinity;
  for (const row of rows) {
    const r = rects[row[0]];
    const dist = Math.abs(y - (r.top + r.height / 2));
    if (dist < bestDist) {
      bestDist = dist;
      best = row;
    }
  }

  for (const i of best) {
    if (x < rects[i].left + rects[i].width / 2) return i;
  }
  return best[best.length - 1] + 1;
}

/** Insertion slot → moveItem target index (dropping past `from` shifts by one). */
export function slotToIndex(slot: number, from: number): number {
  return slot > from ? slot - 1 : slot;
}
