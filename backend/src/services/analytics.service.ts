import type { EventsRepo, NewEvent } from '../data/events.repo';

const MAX_PATH_LEN = 512;
const MAX_PROPS_LEN = 2048;

export type Device = 'mobile' | 'desktop';

/** One device per batch, derived once from the request's User-Agent header. */
export function classifyDevice(userAgent: string | null): Device {
  return userAgent && /Mobi|Android|iPhone|iPad|iPod/i.test(userAgent) ? 'mobile' : 'desktop';
}

export interface BatchEvent {
  type: string;
  path?: string;
  productId?: string;
  props?: Record<string, unknown>;
}

export interface EventBatch {
  visitorId: string;
  sessionId: string;
  userId?: string | null;
  events: BatchEvent[];
}

export interface AnalyticsService {
  recordBatch(batch: EventBatch, userAgent: string | null): Promise<void>;
}

export function createAnalyticsService(deps: { events: EventsRepo }): AnalyticsService {
  return {
    async recordBatch(batch, userAgent) {
      const device = classifyDevice(userAgent);
      const userId = batch.userId ?? null;

      const rows: NewEvent[] = batch.events.map((event) => {
        const path = event.path ? event.path.slice(0, MAX_PATH_LEN) : null;
        // Best-effort like socials' click handling: an oversized props blob drops
        // its payload but never loses the event itself.
        let props: object = event.props ?? {};
        if (JSON.stringify(props).length > MAX_PROPS_LEN) props = {};

        return {
          eventType: event.type,
          visitorId: batch.visitorId,
          sessionId: batch.sessionId,
          userId,
          path,
          productId: event.productId ?? null,
          device,
          props,
        };
      });

      await deps.events.insertBatch(rows);
    },
  };
}
