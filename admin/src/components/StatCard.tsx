interface Props {
  label: string;
  value: string | number;
  hint?: string;
}

export default function StatCard({ label, value, hint }: Props) {
  return (
    <div className="stat">
      <div className="k">{label}</div>
      <div className="v">{value}</div>
      {hint && <div className="hint">{hint}</div>}
    </div>
  );
}
