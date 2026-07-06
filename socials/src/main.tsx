import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { trackScan } from './track';
import './styles/socials.css';

trackScan();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
