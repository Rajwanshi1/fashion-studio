import { describe, expect, it } from 'vitest';
import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { DETAIL1, DETAIL_LEGACY, DETAIL_SALE, DETAIL_SET, mockFetch, renderApp } from './helpers';

const thumbCount = () => document.querySelectorAll('#thumbs .img-slot').length;

describe('PDP', () => {
  it('add to bag opens the drawer and shows the toast', async () => {
    mockFetch((url) => {
      if (url.includes('/api/products/sage-sequin-jacket-lehenga')) return DETAIL1;
      if (url.includes('/api/products')) return { items: [], total: 0, page: 1, pages: 1 };
      if (url.includes('/api/categories')) return [];
      return undefined;
    });

    renderApp('/product/sage-sequin-jacket-lehenga');

    expect(
      await screen.findByRole('heading', { level: 1, name: 'Sage Sequin Jacket Lehenga' }),
    ).toBeInTheDocument();
    expect(screen.getByText('incl. of all taxes')).toBeInTheDocument();

    const user = userEvent.setup();
    await user.click(screen.getByRole('button', { name: 'Add to Bag' }));

    // Drawer slides open with the item inside.
    const drawer = screen.getByLabelText('Shopping bag');
    expect(drawer.className).toContain('open');
    expect(screen.getByText('Sage · Size S · Qty 1')).toBeInTheDocument();

    // Toast confirms.
    expect(screen.getByRole('status')).toHaveTextContent('Added to your bag');

    // Nav count is live.
    expect(screen.getByText('(1)')).toBeInTheDocument();
  });

  it('set includes: pieces default on, unticking reprices, cart gets the selection', async () => {
    mockFetch((url) => {
      if (url.includes('/api/products/fern-zardozi-set-fern')) return DETAIL_SET;
      if (url.includes('/api/products')) return { items: [], total: 0, page: 1, pages: 1 };
      if (url.includes('/api/categories')) return [];
      return undefined;
    });

    renderApp('/product/fern-zardozi-set-fern');
    await screen.findByRole('heading', { level: 1, name: 'Fern Zardozi Set' });

    // Full set by default: 150000 + 12000 + 24000 rupees.
    expect(screen.getByText('₹1,86,000')).toBeInTheDocument();
    const dupatta = screen.getByRole('checkbox', { name: /Dupatta/ });
    const jacket = screen.getByRole('checkbox', { name: /Jacket/ });
    expect(dupatta).toBeChecked();
    expect(jacket).toBeChecked();

    // Removing the jacket drops its price from the total.
    const user = userEvent.setup();
    await user.click(jacket);
    expect(screen.getByText('₹1,62,000')).toBeInTheDocument();

    // The cart line carries the selection and the re-priced unit.
    await user.click(screen.getByRole('button', { name: 'Add to Bag' }));
    expect(screen.getByText('Sage · Size M · Qty 1 · With dupatta')).toBeInTheDocument();
    const stored = JSON.parse(localStorage.getItem('ta.cart') ?? '[]');
    expect(stored[0]).toMatchObject({
      includeDupatta: true,
      includeJacket: false,
      dupattaPrice: 1200000,
      jacketPrice: null,
      unitPrice: 16200000,
    });
  });

  it('renders one thumb per gallery image, poses in the alt text, and swaps the stage', async () => {
    mockFetch((url) => {
      if (url.includes('/api/products/sage-sequin-jacket-lehenga')) return DETAIL1;
      if (url.includes('/api/products')) return { items: [], total: 0, page: 1, pages: 1 };
      if (url.includes('/api/categories')) return [];
      return undefined;
    });

    renderApp('/product/sage-sequin-jacket-lehenga');
    await screen.findByRole('heading', { level: 1, name: 'Sage Sequin Jacket Lehenga' });

    // Three gallery rows → three thumbs (no fixed four-label strip).
    expect(thumbCount()).toBe(3);
    // Thumb 0 is also the stage, hence two matches for its pose.
    expect(screen.getAllByAltText('Sage Sequin Jacket Lehenga — front')).toHaveLength(2);
    // The third row carries no pose → positional fallback.
    expect(screen.getByAltText('Sage Sequin Jacket Lehenga — View 3')).toBeInTheDocument();

    const back = screen.getByAltText('Sage Sequin Jacket Lehenga — back');
    const user = userEvent.setup();
    await user.click(back);
    expect(screen.getAllByAltText('Sage Sequin Jacket Lehenga — back')).toHaveLength(2);
  });

  it('falls back to the single legacy image when the piece has no gallery rows', async () => {
    mockFetch((url) => {
      if (url.includes('/api/products/legacy-single-image')) return DETAIL_LEGACY;
      if (url.includes('/api/products')) return { items: [], total: 0, page: 1, pages: 1 };
      if (url.includes('/api/categories')) return [];
      return undefined;
    });

    renderApp('/product/legacy-single-image');
    await screen.findByRole('heading', { level: 1, name: 'Legacy Single Image' });

    expect(thumbCount()).toBe(1);
    // Thumb + stage, both the denormalized imageUrl.
    const shots = screen.getAllByAltText('Legacy Single Image — View 1');
    expect(shots).toHaveLength(2);
    expect(shots[0]).toHaveAttribute('src', '/img/legacy.jpg');
  });

  it('sale: struck-through pre-sale total, live total = sale base + chosen add-ons', async () => {
    mockFetch((url) => {
      if (url.includes('/api/products/ivory-sale-set')) return DETAIL_SALE;
      if (url.includes('/api/products')) return { items: [], total: 0, page: 1, pages: 1 };
      if (url.includes('/api/categories')) return [];
      return undefined;
    });

    renderApp('/product/ivory-sale-set');
    await screen.findByRole('heading', { level: 1, name: 'Ivory Sale Set' });

    expect(screen.getByText('Sale')).toBeInTheDocument();
    // Base 1,50,000 → 1,20,000; dupatta 12,000 + jacket 24,000 stay full price.
    const struck = screen.getByText('₹1,86,000');
    expect(struck.tagName).toBe('S');
    expect(struck).toHaveClass('was');
    expect(screen.getByText('₹1,56,000')).toBeInTheDocument();

    // Dropping the jacket reprices both lines.
    const user = userEvent.setup();
    await user.click(screen.getByRole('checkbox', { name: /Jacket/ }));
    expect(screen.getByText('₹1,62,000')).toHaveClass('was');
    expect(screen.getByText('₹1,32,000')).toBeInTheDocument();

    // The bag carries the sale-adjusted unit price the server recomputes.
    await user.click(screen.getByRole('button', { name: 'Add to Bag' }));
    const stored = JSON.parse(localStorage.getItem('ta.cart') ?? '[]');
    expect(stored[0]).toMatchObject({ unitPrice: 13200000, dupattaPrice: 1200000, jacketPrice: null });
  });

  it('disables out-of-stock sizes', async () => {
    mockFetch((url) => {
      if (url.includes('/api/products/sage-sequin-jacket-lehenga')) return DETAIL1;
      if (url.includes('/api/categories')) return [];
      return undefined;
    });
    renderApp('/product/sage-sequin-jacket-lehenga');
    await screen.findByRole('heading', { level: 1, name: 'Sage Sequin Jacket Lehenga' });
    expect(screen.getByRole('button', { name: 'L' })).toBeDisabled();
    expect(screen.getByRole('button', { name: 'S' })).toBeEnabled();
  });

  describe('made to measure', () => {
    const routes = (url: string) => {
      if (url.includes('/api/products/sage-sequin-jacket-lehenga')) return DETAIL1;
      if (url.includes('/api/products')) return { items: [], total: 0, page: 1, pages: 1 };
      if (url.includes('/api/categories')) return [];
      return undefined;
    };
    const NOTES_LABEL = 'Share measurements or notes (optional)';

    it('renders the Custom variant as a chip that selects instead of navigating', async () => {
      mockFetch(routes);
      renderApp('/product/sage-sequin-jacket-lehenga');
      await screen.findByRole('heading', { level: 1, name: 'Sage Sequin Jacket Lehenga' });

      const chip = screen.getByRole('button', { name: 'Made to Measure' });
      expect(chip.className).toBe('size custom');

      const user = userEvent.setup();
      await user.click(chip);
      // Still on the PDP — the chip is a variant pick, not a /contact redirect.
      expect(
        screen.getByRole('heading', { level: 1, name: 'Sage Sequin Jacket Lehenga' }),
      ).toBeInTheDocument();
      expect(chip.className).toBe('size custom active');
    });

    it('reveals the measurements panel only while Custom is selected', async () => {
      mockFetch(routes);
      renderApp('/product/sage-sequin-jacket-lehenga');
      await screen.findByRole('heading', { level: 1, name: 'Sage Sequin Jacket Lehenga' });

      expect(screen.queryByLabelText(NOTES_LABEL)).not.toBeInTheDocument();
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Made to Measure' }));
      expect(screen.getByLabelText(NOTES_LABEL)).toBeInTheDocument();
      await user.click(screen.getByRole('button', { name: 'M' }));
      expect(screen.queryByLabelText(NOTES_LABEL)).not.toBeInTheDocument();
    });

    it('adds the typed note to the bag line; standard sizes add an empty note', async () => {
      mockFetch(routes);
      renderApp('/product/sage-sequin-jacket-lehenga');
      await screen.findByRole('heading', { level: 1, name: 'Sage Sequin Jacket Lehenga' });

      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Made to Measure' }));
      await user.type(screen.getByLabelText(NOTES_LABEL), 'bust 36in, waist 30in');
      await user.click(screen.getByRole('button', { name: 'Add to Bag' }));

      let stored = JSON.parse(localStorage.getItem('ta.cart') ?? '[]');
      expect(stored[0]).toMatchObject({
        variantId: 'v4',
        size: 'Custom',
        measurements: 'bust 36in, waist 30in',
      });
      // The note renders on the drawer line too (the textarea also holds the text).
      expect(
        screen.getByText('bust 36in, waist 30in', { selector: '.line-note' }),
      ).toBeInTheDocument();

      // A standard size ignores the (still-typed) draft.
      await user.click(screen.getByRole('button', { name: 'S' }));
      await user.click(screen.getByRole('button', { name: 'Add to Bag' }));
      stored = JSON.parse(localStorage.getItem('ta.cart') ?? '[]');
      expect(stored).toHaveLength(2);
      expect(stored[1]).toMatchObject({ variantId: 'v1', size: 'S', measurements: '' });
    });
  });
});
