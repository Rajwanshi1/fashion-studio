const COPY = [
  'Complimentary Made-to-Order Consultation',
  '·',
  'Worldwide Shipping',
  '·',
  'Spring 2026 — The Verdant Edit',
  '·',
];

export default function Ticker() {
  return (
    <div className="ticker">
      <div className="ticker-track">
        {COPY.map((t, i) => (
          <span key={`a${i}`}>{t}</span>
        ))}
        {COPY.map((t, i) => (
          <span key={`b${i}`}>{t}</span>
        ))}
      </div>
    </div>
  );
}
