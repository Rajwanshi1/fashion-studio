// First-party analytics beacon for the storefront.
//
// Owns visitor/session identity, a small in-memory event queue, batched
// flush to POST /api/track, and the page_view hook wired into the router.
// Philosophy borrowed from socials/src/track.ts: tracking must never throw,
// never block rendering, and every network call is fire-and-forget. This
// task wires only session_start + page_view; instrumenting the rest of the
// event whitelist is a later task.

import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { API_BASE } from './api';

export const TRACK_ENDPOINT = `${API_BASE}/api/track`;

export const FLUSH_MS = 10_000;
export const MAX_BATCH = 20;
const SESSION_IDLE_MS = 30 * 60 * 1000;

const VISITOR_KEY = 'ta.visitor';
const SESSION_KEY = 'ta.session';
const AUTH_KEY = 'ta.auth';

// Mirrors backend/src/routes/analytics.routes.ts EVENT_TYPES — keep in sync.
export type EventType =
  | 'session_start'
  | 'page_view'
  | 'product_view'
  | 'add_to_cart'
  | 'remove_from_cart'
  | 'checkout_start'
  | 'checkout_step'
  | 'payment_result'
  | 'order_placed'
  | 'search'
  | 'filter_apply'
  | 'sort_change'
  | 'wishlist_add'
  | 'wishlist_remove'
  | 'variant_select'
  | 'color_select'
  | 'signup'
  | 'login'
  | 'newsletter_signup'
  | 'contact_submit';

interface QueuedEvent {
  type: EventType;
  path: string;
  productId?: string;
  props?: Record<string, unknown>;
}

function randomUUID(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  // v4 fallback for environments without crypto.randomUUID.
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    const v = c === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

// In-memory fallback used only when localStorage access throws (Safari
// private mode, "block all cookies", etc). Scoped to this page load — never
// persisted, so it's regenerated on the next load.
let memoryVisitorId: string | null = null;
let memorySessionId: string | null = null;
let memorySessionTs = 0;

function getVisitorId(): string {
  try {
    let id = localStorage.getItem(VISITOR_KEY);
    if (!id) {
      id = randomUUID();
      localStorage.setItem(VISITOR_KEY, id);
    }
    return id;
  } catch {
    if (!memoryVisitorId) memoryVisitorId = randomUUID();
    return memoryVisitorId;
  }
}

interface SessionRecord {
  id: string;
  ts: number;
}

/**
 * Reads ta.session, rotating it (new id) when missing or idle for more than
 * 30 minutes, then always rewrites {id, ts: now} to mark this activity. The
 * read-modify-write happens synchronously so a React StrictMode
 * double-invocation in the same tick reads back the just-written ts and can
 * never rotate the session twice.
 */
function getOrRotateSession(): { id: string; rotated: boolean } {
  const now = Date.now();
  try {
    const raw = localStorage.getItem(SESSION_KEY);
    const existing = raw ? (JSON.parse(raw) as Partial<SessionRecord>) : null;
    const stale =
      !existing ||
      typeof existing.id !== 'string' ||
      typeof existing.ts !== 'number' ||
      now - existing.ts > SESSION_IDLE_MS;
    const id = stale ? randomUUID() : (existing!.id as string);
    localStorage.setItem(SESSION_KEY, JSON.stringify({ id, ts: now }));
    return { id, rotated: stale };
  } catch {
    const stale = !memorySessionId || now - memorySessionTs > SESSION_IDLE_MS;
    if (stale) memorySessionId = randomUUID();
    memorySessionTs = now;
    return { id: memorySessionId as string, rotated: stale };
  }
}

/** Read at flush time (not cached) so a login/logout mid-session is picked up. */
function getUserId(): string | null {
  try {
    const raw = localStorage.getItem(AUTH_KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as { user?: { id?: string } };
    return parsed.user?.id ?? null;
  } catch {
    return null;
  }
}

function currentPath(): string {
  try {
    return location.pathname;
  } catch {
    return '/';
  }
}

function currentReferrer(): string | null {
  try {
    return document.referrer || null;
  } catch {
    return null;
  }
}

function parseUtm(): { utmSource: string | null; utmMedium: string | null; utmCampaign: string | null } {
  try {
    const params = new URLSearchParams(location.search);
    return {
      utmSource: params.get('utm_source'),
      utmMedium: params.get('utm_medium'),
      utmCampaign: params.get('utm_campaign'),
    };
  } catch {
    return { utmSource: null, utmMedium: null, utmCampaign: null };
  }
}

let queue: QueuedEvent[] = [];
let flushTimer: ReturnType<typeof setTimeout> | null = null;
// Session id last seen by track(); flush()/flushNow() read this rather than
// re-deriving, so a beacon sent shortly after enqueue can't trigger its own
// (separate) rotation decision.
let cachedSessionId: string | null = null;

function armTimer(): void {
  if (flushTimer) return;
  flushTimer = setTimeout(() => {
    flushTimer = null;
    flush();
  }, FLUSH_MS);
}

/** Pulls up to MAX_BATCH events off the queue, re-arming the timer for any
 *  remainder. Returns null when there's nothing to send. */
function drainBatch(): QueuedEvent[] | null {
  if (flushTimer) {
    clearTimeout(flushTimer);
    flushTimer = null;
  }
  if (queue.length === 0) return null;
  const batch = queue.slice(0, MAX_BATCH);
  queue = queue.slice(MAX_BATCH);
  if (queue.length > 0) armTimer();
  return batch;
}

function envelope(batch: QueuedEvent[]): string {
  return JSON.stringify({
    visitorId: getVisitorId(),
    sessionId: cachedSessionId ?? getOrRotateSession().id,
    userId: getUserId(),
    events: batch,
  });
}

/** Timer-driven flush: plain fetch, fire-and-forget. */
function flush(): void {
  const batch = drainBatch();
  if (!batch) return;
  fetch(TRACK_ENDPOINT, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: envelope(batch),
    keepalive: true,
  }).catch(() => {
    // Fire-and-forget: a dead network must never break the page.
  });
}

/** Unload-path flush: sendBeacon first (survives page teardown); fetch
 *  keepalive fallback when sendBeacon is absent, throws, or returns false. */
function flushNow(): void {
  const batch = drainBatch();
  if (!batch) return;
  const body = envelope(batch);

  let sent = false;
  try {
    if (typeof navigator !== 'undefined' && typeof navigator.sendBeacon === 'function') {
      sent = navigator.sendBeacon(TRACK_ENDPOINT, new Blob([body], { type: 'application/json' }));
    }
  } catch {
    sent = false;
  }

  if (!sent) {
    fetch(TRACK_ENDPOINT, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body,
      keepalive: true,
    }).catch(() => {
      // Fire-and-forget: a dead network must never break the page.
    });
  }
}

let listenersRegistered = false;

function registerListeners(): void {
  if (listenersRegistered || typeof window === 'undefined') return;
  listenersRegistered = true;
  window.addEventListener('pagehide', flushNow);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushNow();
  });
}

registerListeners();

export function track(
  type: EventType,
  data?: { productId?: string; props?: Record<string, unknown> },
): void {
  const path = currentPath();
  const session = getOrRotateSession();
  cachedSessionId = session.id;

  if (session.rotated) {
    queue.push({
      type: 'session_start',
      path,
      props: {
        referrer: currentReferrer(),
        ...parseUtm(),
        landing: path,
      },
    });
  }

  const event: QueuedEvent = { type, path };
  if (data?.productId) event.productId = data.productId;
  if (data?.props) event.props = data.props;
  queue.push(event);

  if (queue.length >= MAX_BATCH) {
    flush();
    return;
  }
  armTimer();
}

// Dedup guard for usePageTracking: React StrictMode double-invokes effects
// in the same commit (same location.key), so the second call is a no-op;
// a real navigation always produces a new key, even A -> B -> A.
let lastPageViewKey: string | null = null;

export function usePageTracking(): void {
  const loc = useLocation();
  useEffect(() => {
    if (loc.key === lastPageViewKey) return;
    lastPageViewKey = loc.key;
    track('page_view');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loc.key]);
}
