/**
 * Where the storefront lives, so the admin can link a piece to the page
 * shoppers actually see. Unlike VITE_API_URL there is no production guard on
 * this one: a missing value degrades to a dev link, it doesn't break the app.
 */
export const SHOP_URL: string =
  (import.meta.env.VITE_SHOP_URL as string | undefined)?.replace(/\/+$/, '') ??
  'http://localhost:5173';

/** Mirrors the storefront route `/product/:slug` (frontend/src/App.tsx). */
export function productUrl(slug: string): string {
  return `${SHOP_URL}/product/${slug}`;
}
