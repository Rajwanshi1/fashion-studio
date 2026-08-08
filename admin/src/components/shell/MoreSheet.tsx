import { useNavigate } from 'react-router-dom';
import { MORE_ITEMS } from '../../lib/nav';
import Sheet from '../ui/Sheet';

interface MoreSheetProps {
  open: boolean;
  onClose: () => void;
  userName: string | null;
  onSignOut: () => void;
}

/** Everything that isn't on the tab bar, plus sign out. */
export default function MoreSheet({ open, onClose, userName, onSignOut }: MoreSheetProps) {
  const navigate = useNavigate();
  const go = (to: string) => {
    onClose();
    navigate(to);
  };
  return (
    <Sheet open={open} onClose={onClose} title="More">
      <nav className="sheet-menu" aria-label="More destinations">
        {MORE_ITEMS.map((item) => (
          <button key={item.to} type="button" className="sheet-item" onClick={() => go(item.to)}>
            <span>
              <strong>{item.label}</strong>
            </span>
          </button>
        ))}
      </nav>
      <div className="sheet-user">
        {userName && <span className="who">{userName}</span>}
        <button type="button" className="ulink" onClick={onSignOut}>
          Sign Out
        </button>
      </div>
    </Sheet>
  );
}
