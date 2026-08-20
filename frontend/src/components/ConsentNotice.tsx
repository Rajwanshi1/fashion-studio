// One-time analytics disclosure — a dismissible hairline bar, acknowledged
// once per browser (localStorage). Never blocks tracking (the analytics are
// first-party and strictly functional); it exists to say so out loud.

import { useState } from 'react';
import { Link } from 'react-router-dom';
import '../styles/consent.css';

const ACK_KEY = 'ta.consent-ack';

function alreadyAcknowledged(): boolean {
  try {
    return localStorage.getItem(ACK_KEY) === '1';
  } catch {
    // Storage blocked: the ack can't persist, so show the bar each load
    // rather than silently never disclosing.
    return false;
  }
}

export default function ConsentNotice() {
  const [dismissed, setDismissed] = useState(alreadyAcknowledged);
  if (dismissed) return null;

  const acknowledge = () => {
    try {
      localStorage.setItem(ACK_KEY, '1');
    } catch {
      // Blocked storage — state still hides it for this page load.
    }
    setDismissed(true);
  };

  return (
    <div className="consent" role="note" aria-label="Analytics notice">
      <p>
        We use first-party analytics (no third-party trackers, no ads) to run this boutique —
        including your IP for security. Continuing means you&rsquo;re okay with that.{' '}
        <Link to="/client-care">Client care &amp; privacy</Link>
      </p>
      <button type="button" onClick={acknowledge}>
        Okay
      </button>
    </div>
  );
}
