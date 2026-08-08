import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import Stepper from '../../components/ui/Stepper';

function Host({ min = 1, max }: { min?: number; max?: number }) {
  const [qty, setQty] = useState('1');
  return (
    <>
      <label htmlFor="qty">Qty</label>
      <Stepper id="qty" label="quantity" value={qty} onChange={setQty} min={min} max={max} />
    </>
  );
}

describe('Stepper', () => {
  it('increments and decrements around the clamp', () => {
    render(<Host min={1} />);
    const dec = screen.getByRole('button', { name: 'Decrease quantity' });
    const inc = screen.getByRole('button', { name: 'Increase quantity' });

    expect(dec).toBeDisabled(); // already at min
    fireEvent.click(inc);
    expect(screen.getByLabelText('Qty')).toHaveValue('2');
    expect(dec).toBeEnabled();
    fireEvent.click(dec);
    expect(screen.getByLabelText('Qty')).toHaveValue('1');
  });

  it('respects max', () => {
    render(<Host min={0} max={2} />);
    const inc = screen.getByRole('button', { name: 'Increase quantity' });
    fireEvent.click(inc);
    expect(inc).toBeDisabled();
  });

  it('filters non-digits while typing and clamps on blur', () => {
    render(<Host min={1} />);
    const input = screen.getByLabelText('Qty');
    fireEvent.change(input, { target: { value: '1a2' } });
    expect(input).toHaveValue('12');
    fireEvent.change(input, { target: { value: '' } });
    fireEvent.blur(input);
    expect(input).toHaveValue('1'); // empty clamps to min
  });
});
