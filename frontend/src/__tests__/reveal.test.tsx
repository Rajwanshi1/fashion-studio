import { afterEach, describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, waitFor } from '@testing-library/react';
import Reveal from '../components/Reveal';

/** In-viewport rect: jsdom returns all-zero rects, which would push every
 *  element down Reveal's IntersectionObserver path. The bug lived in the
 *  immediate-reveal (in-viewport) path, so pin geometry above the fold. */
const IN_VIEW_RECT = {
  top: 120,
  bottom: 480,
  left: 0,
  right: 600,
  width: 600,
  height: 360,
  x: 0,
  y: 120,
  toJSON: () => ({}),
} as DOMRect;

function mountPdpDom() {
  const host = document.createElement('div');
  host.innerHTML = `
    <main class="pdp">
      <div class="gallery"></div>
      <div class="info"><button id="addBtn">Add to Bag</button></div>
    </main>`;
  document.body.appendChild(host);
  return host;
}

async function expectFullyRevealed(host: HTMLElement) {
  await waitFor(
    () => {
      // Reveal must have armed the .pdp children…
      expect(host.querySelectorAll('.rv').length).toBe(2);
      // …and none may stay hidden (.rv without .rv-in = opacity 0 forever).
      expect(host.querySelectorAll('.rv:not(.rv-in)').length).toBe(0);
    },
    { timeout: 2500 },
  );
}

describe('Reveal', () => {
  let host: HTMLElement | null = null;

  afterEach(() => {
    host?.remove();
    host = null;
    vi.restoreAllMocks();
  });

  it('never leaves in-viewport content hidden under StrictMode double-effects', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(IN_VIEW_RECT);
    host = mountPdpDom();

    // StrictMode runs effect → cleanup → effect synchronously (dev behavior).
    // The cleanup must not strand elements tagged .rv without a path to .rv-in.
    render(
      <StrictMode>
        <Reveal watch="p1:1" />
      </StrictMode>,
    );

    await expectFullyRevealed(host);
  });

  it('re-arms reveal when `watch` changes before the first reveal lands (async data)', async () => {
    vi.spyOn(Element.prototype, 'getBoundingClientRect').mockReturnValue(IN_VIEW_RECT);
    host = mountPdpDom();

    const { rerender } = render(<Reveal watch="p1:0" />);
    // Async data (e.g. related products) arrives before the next frame —
    // the effect re-runs and must not cancel the pending reveal for good.
    rerender(<Reveal watch="p1:4" />);

    await expectFullyRevealed(host);
  });
});
