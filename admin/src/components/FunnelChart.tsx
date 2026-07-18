interface FunnelStage {
  stage: string;
  sessions: number;
}

interface Props {
  funnel: FunnelStage[];
}

const VIEW_W = 620;
const ROW_H = 34;
const ROW_GAP = 12;
const BAR_X = 150;
const BAR_MAX_W = 360;

/**
 * 5 horizontal bars, width proportional to sessions / funnel[0].sessions.
 * Each row shows the stage label, its count, and the drop-off % vs the
 * previous stage (none for the first stage). Guarded against a zero (or
 * missing) top-of-funnel stage so an all-zero summary never produces NaN
 * widths — it renders an empty-state note instead.
 */
export default function FunnelChart({ funnel }: Props) {
  const top = funnel[0]?.sessions ?? 0;
  if (funnel.length === 0 || top <= 0) {
    return <p className="state-note">No funnel activity in this window.</p>;
  }

  const rowStep = ROW_H + ROW_GAP;
  const viewH = funnel.length * rowStep;

  return (
    <svg
      viewBox={`0 0 ${VIEW_W} ${viewH}`}
      className="funnel-svg"
      role="img"
      aria-label="Conversion funnel"
    >
      {funnel.map((row, i) => {
        const ratio = Math.max(0, Math.min(1, row.sessions / top));
        const width = ratio * BAR_MAX_W;
        const y = i * rowStep;
        const prevSessions = i > 0 ? funnel[i - 1].sessions : null;
        const dropOff =
          prevSessions !== null && prevSessions > 0
            ? Math.round(((row.sessions - prevSessions) / prevSessions) * 100)
            : null;
        return (
          <g key={row.stage}>
            <text x={0} y={y + ROW_H / 2 + 4} className="funnel-label">
              {row.stage}
            </text>
            <rect x={BAR_X} y={y} width={BAR_MAX_W} height={ROW_H} className="funnel-track" />
            <rect x={BAR_X} y={y} width={width} height={ROW_H} className="funnel-bar" />
            <text x={BAR_X + BAR_MAX_W + 12} y={y + ROW_H / 2 - 2} className="funnel-count">
              {row.sessions.toLocaleString('en-IN')}
            </text>
            <text x={BAR_X + BAR_MAX_W + 12} y={y + ROW_H / 2 + 13} className="funnel-drop">
              {dropOff === null ? '—' : `${dropOff}%`}
            </text>
          </g>
        );
      })}
    </svg>
  );
}
