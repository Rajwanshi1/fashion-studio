import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { formatDate, formatINR } from '../lib/format';
import type { AnalyticsSummary } from '../lib/types';
import StatCard from '../components/StatCard';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';
import FunnelChart from '../components/FunnelChart';
import TrendLine from '../components/TrendLine';
import { Skeleton } from '../components/ui';

type Days = 7 | 30 | 90;
const DAY_OPTIONS: Days[] = [7, 30, 90];

type TopProduct = AnalyticsSummary['topProducts'][number];
type SearchRow = AnalyticsSummary['topSearches'][number];
type SourceRow = AnalyticsSummary['sources'][number];
type DeviceRow = AnalyticsSummary['devices'][number];
type SizeRow = AnalyticsSummary['sizes'][number];
type ColorRow = AnalyticsSummary['colors'][number];

/** num/den as 'x.x%', guarded against a zero denominator. */
function pct(num: number, den: number): string {
  return den > 0 ? `${((num / den) * 100).toFixed(1)}%` : '—';
}

/** Matches the KPI cards' number formatting (StatCard values use en-IN grouping). */
function count(n: number): string {
  return n.toLocaleString('en-IN');
}

const productColumns: Column<TopProduct>[] = [
  { key: 'name', label: 'Product', render: (r) => <span className="nm">{r.name}</span> },
  { key: 'views', label: 'Views', align: 'right', render: (r) => count(r.views) },
  { key: 'carts', label: 'Carts', align: 'right', render: (r) => count(r.carts) },
  { key: 'purchased', label: 'Purchased', align: 'right', render: (r) => count(r.purchased) },
  { key: 'v2c', label: 'View → Cart', align: 'right', render: (r) => pct(r.carts, r.views) },
  { key: 'c2b', label: 'Cart → Buy', align: 'right', render: (r) => pct(r.purchased, r.carts) },
];

const searchColumns: Column<SearchRow>[] = [
  { key: 'query', label: 'Query', render: (r) => <span className="nm">{r.query}</span> },
  { key: 'searches', label: 'Searches', align: 'right', render: (r) => count(r.searches) },
  { key: 'lastAt', label: 'Last searched', render: (r) => formatDate(r.lastAt) },
];

const sourceColumns: Column<SourceRow>[] = [
  { key: 'source', label: 'Source', render: (r) => r.source },
  { key: 'sessions', label: 'Sessions', align: 'right', render: (r) => count(r.sessions) },
];

const deviceColumns: Column<DeviceRow>[] = [
  { key: 'device', label: 'Device', render: (r) => r.device },
  { key: 'sessions', label: 'Sessions', align: 'right', render: (r) => count(r.sessions) },
];

const sizeColumns: Column<SizeRow>[] = [
  { key: 'size', label: 'Size', render: (r) => r.size },
  { key: 'adds', label: 'Adds to cart', align: 'right', render: (r) => count(r.adds) },
];

const colorColumns: Column<ColorRow>[] = [
  { key: 'color', label: 'Color', render: (r) => r.color },
  { key: 'adds', label: 'Adds to cart', align: 'right', render: (r) => count(r.adds) },
];

export default function Analytics() {
  const [days, setDays] = useState<Days>(30);
  const [summary, setSummary] = useState<AnalyticsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    setSummary(null);
    setError(null);
    api<AnalyticsSummary>(`/api/analytics/summary?days=${days}`)
      .then((data) => live && setSummary(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [days]);

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The House · Insight</span>
        <h1>Analytics</h1>
      </div>

      <div className="chips" role="group" aria-label="Date range">
        {DAY_OPTIONS.map((d) => (
          <button
            key={d}
            type="button"
            className={days === d ? 'chip on' : 'chip'}
            onClick={() => setDays(d)}
          >
            {d} Days
          </button>
        ))}
      </div>

      {error && <p className="state-note">{error}</p>}
      {!summary && !error && (
        <>
          <Skeleton variant="stats" count={4} />
          <Skeleton variant="rows" />
        </>
      )}

      {summary && (
        <>
          <p className="section-label" style={{ marginTop: '1.8rem' }}>
            Overview
          </p>
          <div className="stats">
            <StatCard
              label="Sessions"
              value={summary.kpis.sessions.toLocaleString('en-IN')}
              hint={`Last ${days} days`}
            />
            <StatCard
              label="Conversion Rate"
              value={`${(summary.kpis.conversionRate * 100).toFixed(1)}%`}
              hint={`${summary.kpis.orders.toLocaleString('en-IN')} orders`}
            />
            <StatCard
              label="Cart Abandonment"
              value={`${(summary.kpis.cartAbandonmentRate * 100).toFixed(1)}%`}
              hint="Added to cart, never purchased"
            />
            <StatCard
              label="Average Order Value"
              value={formatINR(summary.kpis.aov)}
              hint={`${formatINR(summary.kpis.revenue)} total revenue`}
            />
          </div>

          <div className="charts-row">
            <div className="chart-card">
              <p className="section-label" style={{ marginTop: 0 }}>
                Conversion funnel
              </p>
              <FunnelChart funnel={summary.funnel} />
            </div>
            <div className="chart-card">
              <p className="section-label" style={{ marginTop: 0 }}>
                Sessions &amp; orders trend
              </p>
              <TrendLine trend={summary.trend} />
            </div>
          </div>

          <p className="section-label">Top products</p>
          <DataTable
            columns={productColumns}
            rows={summary.topProducts}
            rowKey={(r) => r.productId}
            empty="No product activity in this window."
          />

          <p className="section-label">Top searches</p>
          <DataTable
            columns={searchColumns}
            rows={summary.topSearches}
            rowKey={(r) => r.query}
            empty="No searches in this window."
          />

          <p className="section-label">Zero-result searches</p>
          <DataTable
            columns={searchColumns}
            rows={summary.zeroSearches}
            rowKey={(r) => r.query}
            empty="Every search found something."
          />

          <p className="section-label">Traffic sources</p>
          <DataTable
            columns={sourceColumns}
            rows={summary.sources}
            rowKey={(r) => r.source}
            empty="No attributed sessions yet."
          />

          <p className="section-label">Devices</p>
          <DataTable
            columns={deviceColumns}
            rows={summary.devices}
            rowKey={(r) => r.device}
            empty="No device data yet."
          />

          <p className="section-label">Sizes added to cart</p>
          <DataTable
            columns={sizeColumns}
            rows={summary.sizes}
            rowKey={(r) => r.size}
            empty="No size data yet."
          />

          <p className="section-label">Colors added to cart</p>
          <DataTable
            columns={colorColumns}
            rows={summary.colors}
            rowKey={(r) => r.color}
            empty="No color data yet."
          />
        </>
      )}
    </>
  );
}
