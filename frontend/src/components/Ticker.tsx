import { TICKER_MIN_CHARS, fillTrack, useSiteContent } from '../lib/content';

export default function Ticker() {
  const { items } = useSiteContent().ticker;
  // The admin edits clean messages; the track supplies the '·' separators and
  // prints the whole run twice so the scroll loops seamlessly. A run shorter
  // than the built-in three messages is repeated first, or half the track —
  // and so half the bar — would be blank between wraps.
  const copy = fillTrack(items, TICKER_MIN_CHARS).flatMap((t) => [t, '·']);
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
