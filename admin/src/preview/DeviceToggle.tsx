import type { PreviewDevice } from './PreviewFrame';

/** Phone / Desktop switch for the previews. Phone first — it is the default
 *  and most of the boutique's visitors. */
export default function DeviceToggle({
  device,
  onChange,
}: {
  device: PreviewDevice;
  onChange: (device: PreviewDevice) => void;
}) {
  const button = (value: PreviewDevice, label: string) => (
    <button
      type="button"
      className="device-btn"
      aria-pressed={device === value}
      onClick={() => onChange(value)}
    >
      {label}
    </button>
  );
  return (
    <div className="device-toggle" role="group" aria-label="Preview device">
      {button('phone', 'Phone')}
      {button('desktop', 'Desktop')}
    </div>
  );
}
