import { createContext, useContext, useEffect } from 'react';

export interface PageChromeValue {
  /** Override the app-bar title (detail pages: order number, piece name). */
  setTitle: (title: string | null) => void;
  /** A list page announces it is searchable; the shell shows the input. */
  registerSearch: (placeholder: string) => void;
  unregisterSearch: () => void;
  query: string;
  setQuery: (query: string) => void;
}

const noop = () => {};

/** Default value keeps pages renderable (and testable) outside the Layout shell. */
export const PageChromeContext = createContext<PageChromeValue>({
  setTitle: noop,
  registerSearch: noop,
  unregisterSearch: noop,
  query: '',
  setQuery: noop,
});

/** Detail pages set a dynamic app-bar title, e.g. the order number. */
export function usePageTitle(title: string | null) {
  const { setTitle } = useContext(PageChromeContext);
  useEffect(() => {
    setTitle(title);
    return () => setTitle(null);
  }, [title, setTitle]);
}

/**
 * List pages: registers the search affordance with the shell and returns the
 * live query. On phones the input renders in the app bar; on desktop the page
 * renders it inline via <ListSearch>.
 */
export function useListSearch(placeholder: string): [string, (query: string) => void] {
  const chrome = useContext(PageChromeContext);
  const { registerSearch, unregisterSearch } = chrome;
  useEffect(() => {
    registerSearch(placeholder);
    return () => unregisterSearch();
  }, [placeholder, registerSearch, unregisterSearch]);
  return [chrome.query, chrome.setQuery];
}
