import { formatDate } from '../lib/format';

interface TrendPoint {
  day: string;
  sessions: number;
  orders: number;
}

interface Props {
  trend: TrendPoint[];
}

const VIEW_W = 600;
const VIEW_H = 160;
const PAD_L = 34;
const PAD_R = 10;
const PAD_T = 12;
const PAD_B = 22;

/**
 * Two polylines (sessions, orders) scaled into a fixed viewBox. Min/max
 * y-axis labels, first/last day x-labels only, plus a legend. Guarded
 * against an empty series or an all-zero window — those render an
 * empty-state note instead of a degenerate/flat line.
 */
export default function TrendLine({ trend }: Props) {
  const maxY = Math.max(0, ...trend.map((t) => Math.max(t.sessions, t.orders)));
  if (trend.length === 0 || maxY <= 0) {
    return <p className="state-note">No sessions or orders in this window.</p>;
  }

  const plotW = VIEW_W - PAD_L - PAD_R;
  const plotH = VIEW_H - PAD_T - PAD_B;
  const n = trend.length;
  const stepX = (i: number) => (n > 1 ? PAD_L + (i / (n - 1)) * plotW : PAD_L + plotW / 2);
  const scaleY = (v: number) => PAD_T + plotH - (v / maxY) * plotH;

  const sessionsPoints = trend.map((t, i) => `${stepX(i)},${scaleY(t.sessions)}`).join(' ');
  const ordersPoints = trend.map((t, i) => `${stepX(i)},${scaleY(t.orders)}`).join(' ');

  const firstDay = formatDate(trend[0].day);
  const lastDay = formatDate(trend[n - 1].day);

  return (
    <div>
      <div className="trend-legend">
        <span className="sw sessions">Sessions</span>
        <span className="sw orders">Orders</span>
      </div>
      <svg
        viewBox={`0 0 ${VIEW_W} ${VIEW_H}`}
        className="trend-svg"
        role="img"
        aria-label="Sessions and orders trend"
      >
        <line x1={PAD_L} y1={PAD_T} x2={PAD_L} y2={PAD_T + plotH} className="trend-axis-line" />
        <line
          x1={PAD_L}
          y1={PAD_T + plotH}
          x2={PAD_L + plotW}
          y2={PAD_T + plotH}
          className="trend-axis-line"
        />

        <text x={2} y={PAD_T + 4} className="trend-axis">
          {maxY.toLocaleString('en-IN')}
        </text>
        <text x={2} y={PAD_T + plotH} className="trend-axis">
          0
        </text>

        <text x={PAD_L} y={VIEW_H - 4} className="trend-axis">
          {firstDay}
        </text>
        <text x={PAD_L + plotW} y={VIEW_H - 4} textAnchor="end" className="trend-axis">
          {lastDay}
        </text>

        <polyline points={sessionsPoints} className="trend-line sessions" fill="none" />
        <polyline points={ordersPoints} className="trend-line orders" fill="none" />
      </svg>
    </div>
  );
}
