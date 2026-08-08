import { fireEvent, render, screen } from '@testing-library/react';
import { useState } from 'react';
import Sheet from '../../components/ui/Sheet';

function Host({ onClosed }: { onClosed?: () => void }) {
  const [open, setOpen] = useState(false);
  const close = () => {
    setOpen(false);
    onClosed?.();
  };
  return (
    <>
      <button onClick={() => setOpen(true)}>Open filters</button>
      <Sheet open={open} onClose={close} title="Filters">
        <button>Apply</button>
      </Sheet>
    </>
  );
}

describe('Sheet', () => {
  it('renders a labelled modal dialog and moves focus inside', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Open filters' }));

    const dialog = screen.getByRole('dialog', { name: 'Filters' });
    expect(dialog).toHaveAttribute('aria-modal', 'true');
    // First focusable element inside receives focus (the close button is first).
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(document.body.style.overflow).toBe('hidden');
  });

  it('closes on Escape and restores focus + body scroll', () => {
    render(<Host />);
    const trigger = screen.getByRole('button', { name: 'Open filters' });
    trigger.focus(); // jsdom clicks don't focus like a browser's do
    fireEvent.click(trigger);
    expect(screen.getByRole('dialog')).toBeInTheDocument();

    fireEvent.keyDown(document, { key: 'Escape' });
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(document.body.style.overflow).toBe('');
    expect(document.activeElement).toBe(trigger);
  });

  it('closes on backdrop click', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Open filters' }));
    fireEvent.click(document.querySelector('.sheet-backdrop')!);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('wraps Tab focus within the dialog', () => {
    render(<Host />);
    fireEvent.click(screen.getByRole('button', { name: 'Open filters' }));
    const apply = screen.getByRole('button', { name: 'Apply' });
    apply.focus();
    // Tab from the last focusable wraps to the first (the close button).
    fireEvent.keyDown(document, { key: 'Tab' });
    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Close' }));
  });
});
