import {
  Navigate,
  Outlet,
  Route,
  RouterProvider,
  createBrowserRouter,
  createRoutesFromElements,
  useLocation,
} from 'react-router-dom';
import { AuthProvider, useAuth } from './lib/auth';
import { ToastProvider } from './components/Toast';
import Layout from './components/Layout';
import Login from './pages/Login';
import BillIntake from './pages/BillIntake';
import Dashboard from './pages/Dashboard';
import Deliveries from './pages/Deliveries';
import Products from './pages/Products';
import ProductEdit from './pages/ProductEdit';
import Orders from './pages/Orders';
import OrderIntake from './pages/OrderIntake';
import Payments from './pages/Payments';
import Users from './pages/Users';
import Socials from './pages/Socials';
import Analytics from './pages/Analytics';
import NotFound from './pages/NotFound';

function RequireAuth() {
  const { token } = useAuth();
  const location = useLocation();
  if (!token) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

// A data router (not <BrowserRouter>) so pages can useBlocker to guard
// unsaved changes against in-app navigation.
const router = createBrowserRouter(
  createRoutesFromElements(
    <>
      <Route path="/login" element={<Login />} />
      <Route element={<RequireAuth />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />
          <Route path="/deliveries" element={<Deliveries />} />
          <Route path="/intake" element={<BillIntake />} />
          <Route path="/products" element={<Products />} />
          <Route path="/products/new" element={<ProductEdit />} />
          <Route path="/products/:id" element={<ProductEdit />} />
          <Route path="/orders" element={<Orders />} />
          <Route path="/orders/new" element={<OrderIntake />} />
          <Route path="/payments" element={<Payments />} />
          <Route path="/users" element={<Users />} />
          <Route path="/socials" element={<Socials />} />
          <Route path="/analytics" element={<Analytics />} />
        </Route>
      </Route>
      <Route path="*" element={<NotFound />} />
    </>,
  ),
);

export default function App() {
  return (
    <AuthProvider>
      <ToastProvider>
        <RouterProvider router={router} />
      </ToastProvider>
    </AuthProvider>
  );
}
