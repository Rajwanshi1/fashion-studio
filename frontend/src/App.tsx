import { useEffect, type ReactNode } from 'react';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { usePageTracking } from './lib/analytics';
import { AuthProvider } from './lib/auth';
import { CartProvider } from './lib/cart';
import { SiteContentProvider } from './lib/content';
import { WishlistProvider } from './lib/wishlist';
import { ToastProvider } from './components/Toast';
import { CartDrawerProvider } from './components/CartDrawer';
import Home from './pages/Home';
import Collection from './pages/Collection';
import Product from './pages/Product';
import CartPage from './pages/CartPage';
import Checkout from './pages/Checkout';
import OrderConfirmation from './pages/OrderConfirmation';
import Login from './pages/Login';
import Account from './pages/Account';
import Wishlist from './pages/Wishlist';
import Search from './pages/Search';
import Lookbook from './pages/Lookbook';
import TheHouse from './pages/TheHouse';
import ClientCare from './pages/ClientCare';
import Contact from './pages/Contact';
import SizeGuide from './pages/SizeGuide';
import NotFound from './pages/NotFound';

function ScrollToTop() {
  const { pathname } = useLocation();
  useEffect(() => {
    window.scrollTo(0, 0);
  }, [pathname]);
  return null;
}

function PageTracking() {
  usePageTracking();
  return null;
}

/** All app providers (router-dependent ones included) — reused by tests. */
export function Providers({ children }: { children: ReactNode }) {
  return (
    <AuthProvider>
      <CartProvider>
        <WishlistProvider>
          <ToastProvider>
            <CartDrawerProvider>{children}</CartDrawerProvider>
          </ToastProvider>
        </WishlistProvider>
      </CartProvider>
    </AuthProvider>
  );
}

export function AppRoutes() {
  return (
    <>
      <ScrollToTop />
      <PageTracking />
      <Routes>
        <Route path="/" element={<Home />} />
        {/* The old editorial /collections page invented five editions that
            never existed (audit §02) — the real catalogue is the honest
            destination until /archive ships. */}
        <Route path="/collections" element={<Navigate to="/collection" replace />} />
        {/* Slugless: the whole catalogue, and the state a category clears to. */}
        <Route path="/collection" element={<Collection />} />
        <Route path="/collection/:categorySlug" element={<Collection />} />
        <Route path="/product/:slug" element={<Product />} />
        <Route path="/cart" element={<CartPage />} />
        <Route path="/checkout" element={<Checkout />} />
        <Route path="/order/:orderNumber" element={<OrderConfirmation />} />
        <Route path="/login" element={<Login />} />
        <Route path="/account" element={<Account />} />
        <Route path="/wishlist" element={<Wishlist />} />
        <Route path="/search" element={<Search />} />
        <Route path="/lookbook" element={<Lookbook />} />
        <Route path="/the-house" element={<TheHouse />} />
        {/* /about never existed but gets typed and linked — land it somewhere real. */}
        <Route path="/about" element={<Navigate to="/the-house" replace />} />
        <Route path="/client-care" element={<ClientCare />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/size-guide" element={<SizeGuide />} />
        <Route path="*" element={<NotFound />} />
      </Routes>
    </>
  );
}

export default function App() {
  return (
    <SiteContentProvider>
      <BrowserRouter>
        <Providers>
          <AppRoutes />
        </Providers>
      </BrowserRouter>
    </SiteContentProvider>
  );
}
