import '@testing-library/jest-dom/vitest';
import { afterEach } from 'vitest';
import { cleanup } from '@testing-library/react';

// jsdom lacks these browser APIs used by Reveal/Ambient/Nav.
if (!('IntersectionObserver' in globalThis)) {
  class IO {
    observe() {}
    unobserve() {}
    disconnect() {}
    takeRecords() {
      return [];
    }
  }
  (globalThis as Record<string, unknown>).IntersectionObserver = IO;
}

if (typeof window !== 'undefined' && typeof window.matchMedia !== 'function') {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => {},
      removeListener: () => {},
      addEventListener: () => {},
      removeEventListener: () => {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

if (typeof window !== 'undefined') {
  window.scrollTo = (() => {}) as typeof window.scrollTo;
}

// jsdom lacks Element.scrollTo — the stage carousel scrolls its track with it.
// Record the position so tests can assert where a snap/jump landed.
if (typeof Element !== 'undefined' && !Element.prototype.scrollTo) {
  Element.prototype.scrollTo = function scrollTo(
    this: Element,
    xOrOptions?: number | ScrollToOptions,
    y?: number,
  ) {
    if (typeof xOrOptions === 'object' && xOrOptions !== null) {
      if (xOrOptions.left != null) this.scrollLeft = xOrOptions.left;
      if (xOrOptions.top != null) this.scrollTop = xOrOptions.top;
    } else {
      if (typeof xOrOptions === 'number') this.scrollLeft = xOrOptions;
      if (typeof y === 'number') this.scrollTop = y;
    }
  } as typeof Element.prototype.scrollTo;
}

// jsdom ships neither PointerEvent nor pointer capture; the carousel's
// mouse drag-to-scroll needs both.
if (typeof window !== 'undefined' && typeof window.PointerEvent === 'undefined') {
  class PointerEventPolyfill extends MouseEvent {
    pointerId: number;
    pointerType: string;
    constructor(type: string, init: PointerEventInit = {}) {
      super(type, init);
      this.pointerId = init.pointerId ?? 0;
      this.pointerType = init.pointerType ?? 'mouse';
    }
  }
  window.PointerEvent = PointerEventPolyfill as unknown as typeof PointerEvent;
}
if (typeof Element !== 'undefined' && !Element.prototype.setPointerCapture) {
  Element.prototype.setPointerCapture = () => {};
  Element.prototype.releasePointerCapture = () => {};
  Element.prototype.hasPointerCapture = () => false;
}

afterEach(() => {
  cleanup();
  localStorage.clear();
});
