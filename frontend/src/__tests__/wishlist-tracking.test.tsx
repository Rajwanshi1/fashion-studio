import { describe, expect, it, vi } from 'vitest';
import { StrictMode } from 'react';
import { render, screen, fireEvent } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { Providers } from '../App';
import { useWishlist } from '../lib/wishlist';

// toggle() previously computed `exists` and called track() inside the
// setIds functional updater. React 18 StrictMode double-invokes functional
// updaters passed to setState (not just mount effects — every call), so
// every click fired the event twice in dev, corrupting wishlist funnel
// counts. The fix reads `exists` from `ids` outside the updater so track()
// runs exactly once per click, independent of how many times React
// re-invokes the (now side-effect-free) updater. This test renders under
// StrictMode to exercise that guarantee directly.
vi.mock('../lib/analytics', async (importOriginal) => {
  const actual = await importOriginal<typeof import('../lib/analytics')>();
  return { ...actual, track: vi.fn() };
});

import { track } from '../lib/analytics';

function ToggleButton() {
  const { toggle } = useWishlist();
  return (
    <button type="button" onClick={() => toggle('p1')}>
      toggle
    </button>
  );
}

describe('Wishlist — toggle tracking', () => {
  it('fires exactly one wishlist_add per click despite StrictMode double-invoking the setState updater', () => {
    render(
      <StrictMode>
        <MemoryRouter>
          <Providers>
            <ToggleButton />
          </Providers>
        </MemoryRouter>
      </StrictMode>,
    );

    fireEvent.click(screen.getByText('toggle'));

    const addCalls = vi.mocked(track).mock.calls.filter(([type]) => type === 'wishlist_add');
    expect(addCalls).toHaveLength(1);
    expect(addCalls[0][1]).toEqual({ productId: 'p1' });
  });

  it('fires exactly one wishlist_remove when toggled back off', () => {
    render(
      <StrictMode>
        <MemoryRouter>
          <Providers>
            <ToggleButton />
          </Providers>
        </MemoryRouter>
      </StrictMode>,
    );

    fireEvent.click(screen.getByText('toggle')); // add
    fireEvent.click(screen.getByText('toggle')); // remove

    const removeCalls = vi.mocked(track).mock.calls.filter(([type]) => type === 'wishlist_remove');
    expect(removeCalls).toHaveLength(1);
  });
});
