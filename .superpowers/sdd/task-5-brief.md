# Task 5: Admin Analytics page — KPIs, funnel SVG, trend SVG, tables

Dashboard for the analytics data. `GET /api/analytics/summary?days=7|30|90` exists (admin JWT), returning the `AnalyticsSummary` shape below. All work in `admin/`. NO new npm dependencies — charts are hand-rolled inline SVG.

## Pattern templates (read first)

- `admin/src/pages/Socials.tsx` — page structure: fetch with live-flag effect, error → note, loading state, DataTable usage
- `admin/src/pages/Dashboard.tsx` — StatCard row layout
- `admin/src/components/StatCard.tsx`, `DataTable.tsx` — reuse as-is
- `admin/src/App.tsx` (route registration), `admin/src/components/Layout.tsx` (nav), `admin/src/lib/types.ts`, `admin/src/lib/api.ts`
- Check `admin/src/lib/` for an existing paise/INR formatter (Dashboard formats revenue) and reuse it.

## Types — add to `admin/src/lib/types.ts`

```ts
export interface AnalyticsSummary {
  kpis: { sessions: number; orders: number; revenue: number;   // paise
          conversionRate: number; cartAbandonmentRate: number; aov: number };
  funnel: Array<{ stage: string; sessions: number }>;
  trend: Array<{ day: string; sessions: number; orders: number }>;
  topProducts: Array<{ productId: string; name: string; views: number; carts: number; purchased: number }>;
  topSearches: Array<{ query: string; searches: number; lastAt: string }>;
  zeroSearches: Array<{ query: string; searches: number; lastAt: string }>;
  sources: Array<{ source: string; sessions: number }>;
  devices: Array<{ device: string; sessions: number }>;
  sizes: Array<{ size: string; adds: number }>;
  colors: Array<{ color: string; adds: number }>;
}
```

## `admin/src/pages/Analytics.tsx` (new)

- `days` state: `7 | 30 | 90`, default 30; three toggle buttons styled like existing button patterns (check Socials.tsx for button classes); changing refetches.
- Fetch `api<AnalyticsSummary>('/api/analytics/summary?days='+days)` in an effect keyed on `days`, live-flag pattern, error note + loading copy like Socials.
- **KPI row** (4 StatCards): Sessions; Conversion Rate as `x.x%`; Cart Abandonment as `x.x%`; AOV formatted ₹ from paise.
- **FunnelChart** (below KPIs), **TrendLine** (beside/below per layout that fits existing CSS).
- **DataTables**: Top products — columns name, views, carts, purchased, view→cart % and cart→buy % computed inline (guard /0 → '—'); Top searches (query, searches, lastAt); Zero-result searches; Traffic sources; Devices; Sizes; Colors. Empty-state copy per table (DataTable has an `empty` prop).

## `admin/src/components/FunnelChart.tsx` (new)

Inline SVG, ~60 lines, props `{ funnel: Array<{stage, sessions}> }`:
- 5 horizontal bars, width proportional to `sessions / funnel[0].sessions` (guard first stage 0 → all-zero empty note instead of NaN widths).
- Each row: stage label, count, and drop-off % vs previous stage (`-38%` style; first stage none).
- Fixed viewBox, responsive width, colors from existing admin CSS variables (inspect admin CSS for var names; fall back to currentColor/opacity styling if no suitable vars).

## `admin/src/components/TrendLine.tsx` (new)

Inline SVG, props `{ trend: Array<{day, sessions, orders}> }`:
- Two polylines (sessions, orders — distinguishable stroke/opacity), points scaled into fixed viewBox ~600×160.
- Min/max y-axis labels, first/last day x-labels only. Legend (two labeled swatches).
- All-zero/empty series → empty-state note instead of a flat line.

## Wiring

- Route `/analytics` in `admin/src/App.tsx` inside RequireAuth › Layout.
- `<NavLink to="/analytics">Analytics</NavLink>` in `Layout.tsx` after Socials.

## Tests — `admin/src/__tests__/analytics.test.tsx` (model: `socials.test.tsx`)

- Mock fetch → fixture AnalyticsSummary: KPI values rendered; 5 funnel stage labels + a drop-off % visible; a top-product row rendered.
- Clicking "7 days" triggers refetch with `?days=7` (assert on fetch mock).
- Fetch rejection → error note.

## Acceptance

`npm test` green in `admin/`, TypeScript/build clean, page renders sensibly with an all-zero summary (no NaN, no broken SVG).
