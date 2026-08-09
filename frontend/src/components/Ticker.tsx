import { useSiteContent } from '../lib/content';

export default function Ticker() {
  const { items } = useSiteContent().ticker;
  // The admin edits clean messages; the track supplies the '·' separators and
  // prints the whole run twice so the scroll loops seamlessly.
  const copy = items.flatMap((t) => [t, '·']);
  return (
    <div className="ticker">
      <div className="ticker-track">
        {copy.map((t, i) => (
          <span key={`a${i}`}>{t}</span>
        ))}
        {copy.map((t, i) => (
          <span key={`b${i}`}>{t}</span>
        ))}
      </div>
    </div>
  );
}
