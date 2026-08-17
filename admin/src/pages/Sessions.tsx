import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { formatDateTime } from '../lib/format';
import type { SessionEvent, SessionOutcome, SessionSummary, SessionsPage, VisitorDetail } from '../lib/types';
import DataTable from '../components/DataTable';
import type { Column } from '../components/DataTable';

type Days = 7 | 30 | 90;
const DAY_OPTIONS: Days[] = [7, 30, 90];

type OutcomeFilter = 'all' | SessionOutcome | 'abandoned';
const OUTCOME_OPTIONS: { value: OutcomeFilter; label: string }[] = [
  { value: 'all', label: 'All' },
  { value: 'ordered', label: 'Ordered' },
  { value: 'checkout', label: 'Checkout' },
  { value: 'carted', label: 'Carted' },
  { value: 'browsed', label: 'Browsed' },
  { value: 'abandoned', label: 'Abandoned' },
];

const OUTCOME_LABELS: Record<SessionOutcome, string> = {
  ordered: 'Ordered',
  checkout: 'Checkout',
  carted: 'Carted',
  browsed: 'Browsed',
};

/** Reuses the order-badge tones: deeper funnel = warmer tone. */
const OUTCOME_TONES: Record<SessionOutcome, string> = {
  ordered: 'paid',
  checkout: 'crafting',
  carted: 'dispatched',
  browsed: 'pending',
};

function formatDuration(sec: number): string {
  if (sec < 60) return `${sec}s`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}m ${sec % 60}s`;
  return `${Math.floor(m / 60)}h ${m % 60}m`;
}

/** m:ss offset from the session's first event, for timeline rows. */
function offsetLabel(startedAt: string, occurredAt: string): string {
  const sec = Math.max(0, Math.round((new Date(occurredAt).getTime() - new Date(startedAt).getTime()) / 1000));
  return `+${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, '0')}`;
}

/** Compact props line — key: value pairs, long values elided. */
function compactProps(props: Record<string, unknown>): string {
  const entries = Object.entries(props).filter(([, v]) => v !== null && v !== '');
  if (entries.length === 0) return '';
  return entries
    .map(([k, v]) => {
      const raw = typeof v === 'object' ? JSON.stringify(v) : String(v);
      return `${k}: ${raw.length > 40 ? `${raw.slice(0, 40)}…` : raw}`;
    })
    .join(' · ');
}

function SessionTimeline({ session }: { session: SessionSummary }) {
  const [events, setEvents] = useState<SessionEvent[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    api<SessionEvent[]>(`/api/analytics/sessions/${session.sessionId}`)
      .then((data) => live && setEvents(data))
      .catch((err: Error) => live && setError(err.message));
    return () => {
      live = false;
    };
  }, [session.sessionId]);

  if (error) return <p className="state-note">{error}</p>;
  if (!events) return <p className="state-note">Loading timeline…</p>;

  return (
    <ul className="timeline" aria-label="Session timeline">
      {events.map((e, i) => (
        <li key={i}>
          <span className="t-offset">{offsetLabel(session.startedAt, e.occurredAt)}</span>
          <span className="t-type">{e.eventType.replace(/_/g, ' ')}</span>
          <span className="t-detail">
            {e.productName ?? e.path ?? ''}
            {compactProps(e.props) && <span className="t-props"> {compactProps(e.props)}</span>}
          </span>
        </li>
      ))}
    </ul>
  );
}

export default function Sessions() {
  const [days, setDays] = useState<Days>(30);
  const [outcome, setOutcome] = useState<OutcomeFilter>('all');
  const [page, setPage] = useState(1);
  const [data, setData] = useState<SessionsPage | null>(null);
  const [visitor, setVisitor] = useState<VisitorDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [searchParams, setSearchParams] = useSearchParams();
  const visitorId = searchParams.get('visitor');

  useEffect(() => {
    let live = true;
    setData(null);
    setVisitor(null);
    setError(null);
    if (visitorId) {
      api<VisitorDetail>(`/api/analytics/visitors/${visitorId}`)
        .then((d) => live && setVisitor(d))
        .catch((err: Error) => live && setError(err.message));
    } else {
      api<SessionsPage>(`/api/analytics/sessions?days=${days}&outcome=${outcome}&page=${page}`)
        .then((d) => live && setData(d))
        .catch((err: Error) => live && setError(err.message));
    }
    return () => {
      live = false;
    };
  }, [days, outcome, page, visitorId]);

  const columns: Column<SessionSummary>[] = [
    { key: 'started', label: 'Started', render: (s) => formatDateTime(s.startedAt) },
    { key: 'duration', label: 'Duration', align: 'right', render: (s) => formatDuration(s.durationSec) },
    { key: 'device', label: 'Device', render: (s) => s.device },
    { key: 'landing', label: 'Landing', render: (s) => s.landingPath ?? '—' },
    { key: 'events', label: 'Events', align: 'right', render: (s) => s.eventCount },
    {
      key: 'outcome',
      label: 'Outcome',
      render: (s) => (
        <>
          <span className={`badge ${OUTCOME_TONES[s.outcome]}`}>{OUTCOME_LABELS[s.outcome]}</span>
          {s.abandoned && <span className="badge muted">Abandoned</span>}
        </>
      ),
    },
    { key: 'order', label: 'Order', render: (s) => s.orderNumber ?? '—' },
    {
      key: 'visitor',
      label: 'Visitor',
      render: (s) => (
        <Link
          className="ulink"
          to={`/sessions?visitor=${s.visitorId}`}
          onClick={(e) => e.stopPropagation()}
          title={s.visitorId}
        >
          {s.visitorId.slice(0, 8)}
        </Link>
      ),
    },
    { key: 'ip', label: 'IP', render: (s) => s.ip ?? '—' },
  ];

  const sessions = visitor ? visitor.sessions : data?.sessions;
  const totalPages = data ? Math.max(1, Math.ceil(data.total / data.pageSize)) : 1;

  return (
    <>
      <div className="page-head-admin">
        <span className="eyebrow">The House · Insight</span>
        <h1>Sessions</h1>
      </div>

      {visitorId ? (
        <p className="state-note">
          Sessions for visitor <span title={visitorId}>{visitorId.slice(0, 8)}</span> ·{' '}
          <button type="button" className="ulink" onClick={() => setSearchParams({})}>
            ← All sessions
          </button>
        </p>
      ) : (
        <>
          <div className="chips" role="group" aria-label="Date range">
            {DAY_OPTIONS.map((d) => (
              <button
                key={d}
                type="button"
                className={days === d ? 'chip on' : 'chip'}
                onClick={() => {
                  setDays(d);
                  setPage(1);
                }}
              >
                {d} Days
              </button>
            ))}
          </div>

          <div className="chips" role="group" aria-label="Filter by outcome">
            {OUTCOME_OPTIONS.map((o) => (
              <button
                key={o.value}
                type="button"
                className={outcome === o.value ? 'chip on' : 'chip'}
                onClick={() => {
                  setOutcome(o.value);
                  setPage(1);
                }}
              >
                {o.label}
              </button>
            ))}
          </div>
        </>
      )}

      {visitor && (
        <p className="state-note">
          {visitor.sameIpSessions > 0
            ? `${visitor.sameIpSessions} session(s) from other visitors share this visitor's latest IP — possibly the same person on another device.`
            : 'No other visitors share this visitor’s latest IP.'}
        </p>
      )}

      {error && <p className="state-note">{error}</p>}
      {!sessions && !error && <p className="state-note">Loading sessions…</p>}

      {sessions && (
        <DataTable
          columns={columns}
          rows={sessions}
          rowKey={(s) => s.sessionId}
          empty="No sessions in this window."
          renderExpanded={(s) => <SessionTimeline session={s} />}
        />
      )}

      {!visitorId && data && data.total > data.pageSize && (
        <div className="chips pager" role="group" aria-label="Pagination">
          <button type="button" className="chip" disabled={page <= 1} onClick={() => setPage(page - 1)}>
            ‹ Prev
          </button>
          <span className="page-count">
            Page {page} of {totalPages}
          </span>
          <button
            type="button"
            className="chip"
            disabled={page >= totalPages}
            onClick={() => setPage(page + 1)}
          >
            Next ›
          </button>
        </div>
      )}
    </>
  );
}
