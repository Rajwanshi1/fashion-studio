import { useNavigate } from 'react-router-dom';
import Sheet from '../ui/Sheet';
import { CameraIcon, PenIcon } from './icons';

interface CaptureSheetProps {
  open: boolean;
  onClose: () => void;
}

/** The ⊕ sheet — the two ways to record a sale. */
export default function CaptureSheet({ open, onClose }: CaptureSheetProps) {
  const navigate = useNavigate();
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  return (
    <Sheet open={open} onClose={onClose} title="Record a sale">
      <div className="sheet-menu">
        <button type="button" className="sheet-item" onClick={() => go('/intake')}>
          <CameraIcon />
          <span>
            <strong>Scan Bill</strong>
            <small>Photograph the bill — Claude fills the order in</small>
          </span>
        </button>
        <button type="button" className="sheet-item" onClick={() => go('/orders/new')}>
          <PenIcon />
          <span>
            <strong>New Order</strong>
            <small>Type the order in yourself</small>
          </span>
        </button>
      </div>
    </Sheet>
  );
}
