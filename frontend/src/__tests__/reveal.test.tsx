import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { render } from '@testing-library/react';
import Reveal from '../components/Reveal';

/** The audit's blank-until-scroll bug: in-viewport elements wait on a double
 *  requestAnimationFrame that a throttled/backgrounded tab or a crawler never
 *  fires, and the old safety net only swept the below-the-fold `pending` set —
 *  so above-the-fold content stayed at opacity 0 forever. */
describe('Reveal safety net', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    // rAF that never calls back — the throttled-tab / crawler environment.
    vi.stubGlobal('requestAnimationFrame', () => 0);
    vi.stubGlobal('cancelAnimationFrame', () => undefined);
    // jsdom rects are all zeros; report "in the viewport" instead.
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue({
      top: 10,
      bottom: 100,
      left: 0,
      right: 100,
      width: 100,
      height: 90,
      x: 0,
      y: 10,
      toJSON: () => ({}),
    } as DOMRect);
  });
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
    vi.useRealTimers();
    document.body.innerHTML = '';
  });

  it('force-reveals in-viewport content when rAF never fires', () => {
    const host = document.createElement('div');
    host.innerHTML = '<div class="sec-head">above the fold</div>';
    document.body.appendChild(host);

    render(<Reveal />);

    const el = host.querySelector('.sec-head')!;
    expect(el.classList.contains('rv')).toBe(true);
    expect(el.classList.contains('rv-in')).toBe(false);

    vi.advanceTimersByTime(2500);
    expect(el.classList.contains('rv-in')).toBe(true);
  });
});
