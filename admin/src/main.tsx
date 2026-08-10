import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import './styles/brand.css';
import './styles/admin.css';

// The router lives inside App (createBrowserRouter) — a data router is what
// lets forms block navigation while they hold unsaved changes.
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
