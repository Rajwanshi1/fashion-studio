import { useNavigate } from 'react-router-dom';
import { BackIcon } from './icons';

interface AppBarProps {
  title: string;
  backTo?: string;
  searchPlaceholder: string | null;
  query: string;
  onQueryChange: (query: string) => void;
}

/** Phone top bar: back chevron on detail pages, page title, search on list pages. */
export default function AppBar({ title, backTo, searchPlaceholder, query, onQueryChange }: AppBarProps) {
  const navigate = useNavigate();
  return (
    <header className="appbar">
      <div className="appbar-top">
        {backTo && (
          <button
            type="button"
            className="appbar-back"
            aria-label="Back"
            onClick={() => navigate(backTo)}
          >
            <BackIcon />
          </button>
        )}
        <h1 className="appbar-title">{title}</h1>
      </div>
      {searchPlaceholder && (
        <input
          className="inp appbar-search"
          type="search"
          placeholder={searchPlaceholder}
          aria-label={searchPlaceholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
        />
      )}
    </header>
  );
}
