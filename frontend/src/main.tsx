import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/brand.css';
import './styles/shop.css';
import './styles/mobile-nav.css';
import './styles/cart-drawer.css';
import './styles/first-order-popup.css';
import './styles/app.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
