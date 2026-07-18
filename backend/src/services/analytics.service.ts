import type {
  ColorRow,
  DeviceRow,
  EventsRepo,
  NewEvent,
  SearchRow,
  SizeRow,
  SourceRow,
  TopProduct,
  TrendDay,
} from '../data/events.repo';

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

export type FunnelStageLabel = 'Sessions' | 'Product views' | 'Added to cart' | 'Checkout' | 'Purchased';

export interface FunnelStage {
  stage: FunnelStageLabel;
  sessions: number;
}

export interface AnalyticsSummary {
  kpis: {
    sessions: number;
    orders: number;
    revenue: number;
    conversionRate: number;
    cartAbandonmentRate: number;
    aov: number;
  };
  funnel: FunnelStage[];
  trend: TrendDay[];
  topProducts: TopProduct[];
  topSearches: SearchRow[];
  zeroSearches: SearchRow[];
  sources: SourceRow[];
  devices: DeviceRow[];
  sizes: SizeRow[];
  colors: ColorRow[];
}

export interface AnalyticsService {
  recordBatch(batch: EventBatch, userAgent: string | null): Promise<void>;
  summary(days: number): Promise<AnalyticsSummary>;
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

    async summary(days) {
      const [kpi, trend, topProducts, topSearches, zeroSearches, sources, devices, sizes, colors] = await Promise.all([
        deps.events.kpiAndFunnel(days),
        deps.events.dailyTrend(days),
        deps.events.topProducts(days),
        deps.events.topSearches(days),
        deps.events.zeroSearches(days),
        deps.events.sources(days),
        deps.events.devices(days),
        deps.events.sizes(days),
        deps.events.colors(days),
      ]);

      // Every rate is zero-guarded: an empty denominator yields 0, never NaN/Infinity.
      const conversionRate = kpi.sessions > 0 ? kpi.orderSessions / kpi.sessions : 0;
      const cartAbandonmentRate =
        kpi.cartSessions > 0 ? Math.max(0, (kpi.cartSessions - kpi.orderSessions) / kpi.cartSessions) : 0;
      const aov = kpi.orders > 0 ? Math.round(kpi.revenue / kpi.orders) : 0;

      return {
        kpis: {
          sessions: kpi.sessions,
          orders: kpi.orders,
          revenue: kpi.revenue,
          conversionRate,
          cartAbandonmentRate,
          aov,
        },
        funnel: [
          { stage: 'Sessions', sessions: kpi.sessions },
          { stage: 'Product views', sessions: kpi.pdpSessions },
          { stage: 'Added to cart', sessions: kpi.cartSessions },
          { stage: 'Checkout', sessions: kpi.checkoutSessions },
          { stage: 'Purchased', sessions: kpi.orderSessions },
        ],
        trend,
        topProducts,
        topSearches,
        zeroSearches,
        sources,
        devices,
        sizes,
        colors,
      };
    },
  };
}
