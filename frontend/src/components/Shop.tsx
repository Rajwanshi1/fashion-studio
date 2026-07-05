import type { ReactNode } from 'react';
import Ticker from './Ticker';
import Nav from './Nav';
import Footer from './Footer';

interface ShopProps {
  /** Page-scoped class (e.g. "page-plp") applied to the whole chrome. */
  page: string;
  children: ReactNode;
}

/** Standard inner-page chrome: ticker + sticky nav + footer. */
export default function Shop({ page, children }: ShopProps) {
  return (
    <div className={page}>
      <Ticker />
      <Nav />
      {children}
      <Footer />
    </div>
  );
}
