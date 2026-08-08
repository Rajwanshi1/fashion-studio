import { useContext } from 'react';
import { PageChromeContext } from '../../lib/pageChrome';

/** Desktop inline search box — binds to the same query the phone app bar edits. */
export default function ListSearch({ placeholder }: { placeholder: string }) {
  const { query, setQuery } = useContext(PageChromeContext);
  return (
    <input
      className="inp list-search"
      type="search"
      placeholder={placeholder}
      aria-label={placeholder}
      value={query}
      onChange={(e) => setQuery(e.target.value)}
    />
  );
}
