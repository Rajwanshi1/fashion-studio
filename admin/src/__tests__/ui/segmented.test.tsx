import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import SegmentedControl from '../../components/ui/SegmentedControl';

const OPTIONS = [
  { value: 'cash', label: 'Cash' },
  { value: 'online', label: 'Online' },
] as const;

function Host() {
  const [mode, setMode] = useState<'cash' | 'online'>('cash');
  return <SegmentedControl label="Payment mode" options={[...OPTIONS]} value={mode} onChange={setMode} />;
}

describe('SegmentedControl', () => {
  it('renders a radiogroup with the current choice checked', () => {
    render(<Host />);
    expect(screen.getByRole('radiogroup', { name: 'Payment mode' })).toBeInTheDocument();
    expect(screen.getByRole('radio', { name: 'Cash' })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('radio', { name: 'Online' })).toHaveAttribute('aria-checked', 'false');
  });

  it('changes selection on click', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('radio', { name: 'Online' }));
    expect(screen.getByRole('radio', { name: 'Online' })).toHaveAttribute('aria-checked', 'true');
  });

  it('moves selection with arrow keys and wraps', () => {
    render(<Host />);
    const cash = screen.getByRole('radio', { name: 'Cash' });
    cash.focus();
    fireEvent.keyDown(cash, { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Online' })).toHaveAttribute('aria-checked', 'true');
    fireEvent.keyDown(screen.getByRole('radio', { name: 'Online' }), { key: 'ArrowRight' });
    expect(screen.getByRole('radio', { name: 'Cash' })).toHaveAttribute('aria-checked', 'true');
  });

  it('keeps only the selected option in the tab order', () => {
    render(<Host />);
    expect(screen.getByRole('radio', { name: 'Cash' })).toHaveAttribute('tabindex', '0');
    expect(screen.getByRole('radio', { name: 'Online' })).toHaveAttribute('tabindex', '-1');
  });
});
