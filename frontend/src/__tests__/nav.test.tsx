import { describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import { Providers } from '../App';
import Nav from '../components/Nav';
import { useCart, type CartItem } from '../lib/cart';

const item: Omit<CartItem, 'qty' | 'addedAt'> = {
  variantId: 'v1',
  productId: 'p1',
  productSlug: 'sage-sequin-jacket-lehenga',
  name: 'Sage Sequin Jacket Lehenga',
  size: 'S',
  color: 'Sage',
  unitPrice: 18400000,
  imageUrl: null,
  includedComponents: [],
  excludedComponents: [],
  measurements: '',
};

function AddButton() {
  const { add } = useCart();
  return <button onClick={() => add(item)}>seed-add</button>;
}

describe('Nav bag count', () => {
  it('shows a live cart count', async () => {
    const user = userEvent.setup();
    render(
      <MemoryRouter>
        <Providers>
          <Nav />
          <AddButton />
        </Providers>
      </MemoryRouter>,
    );

    expect(screen.getByText('(0)')).toBeInTheDocument();
    await user.click(screen.getByText('seed-add'));
    expect(screen.getByText('(1)')).toBeInTheDocument();
    await user.click(screen.getByText('seed-add'));
    expect(screen.getByText('(2)')).toBeInTheDocument();
  });
});
