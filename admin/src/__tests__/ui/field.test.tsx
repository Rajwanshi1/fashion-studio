import { render, screen } from '@testing-library/react';
import Field from '../../components/ui/Field';
import { Input } from '../../components/ui/Input';

describe('Field', () => {
  it('associates the label with the control via the render prop', () => {
    render(
      <Field id="f-phone" label="Phone">
        {(a11y) => <Input {...a11y} type="tel" />}
      </Field>,
    );
    expect(screen.getByLabelText('Phone')).toBeInTheDocument();
  });

  it('wires an inline error to the input with aria attributes', () => {
    render(
      <Field id="f-phone" label="Phone" error="Enter a valid mobile number">
        {(a11y) => <Input {...a11y} type="tel" />}
      </Field>,
    );
    const input = screen.getByLabelText('Phone');
    expect(input).toHaveAttribute('aria-invalid', 'true');
    expect(input).toHaveAccessibleDescription('Enter a valid mobile number');
  });

  it('shows the hint only while there is no error', () => {
    const { rerender } = render(
      <Field id="f-pin" label="PIN" hint="6 digits">
        {(a11y) => <Input {...a11y} />}
      </Field>,
    );
    expect(screen.getByText('6 digits')).toBeInTheDocument();
    rerender(
      <Field id="f-pin" label="PIN" hint="6 digits" error="PIN must be 6 digits">
        {(a11y) => <Input {...a11y} />}
      </Field>,
    );
    expect(screen.queryByText('6 digits')).not.toBeInTheDocument();
    expect(screen.getByText('PIN must be 6 digits')).toBeInTheDocument();
  });
});
