import { Pool } from 'pg';

export interface LinkStats {
  link: string;
  /** Scan source that brought this visitor, or null when they arrived without a QR/UTM tag. */
  source: string | null;
  total: number;
  last7: number;
  last30: number;
  lastClickAt: string;
}

export interface ClicksRepo {
  insert(link: string, source: string | null, userAgent: string | null, referer: string | null): Promise<void>;
  statsByLink(): Promise<LinkStats[]>;
}

export function createClicksRepo(pool: Pool): ClicksRepo {
  return {
    async insert(link, source, userAgent, referer) {
      await pool.query(
        'INSERT INTO social_clicks (link, source, user_agent, referer) VALUES ($1,$2,$3,$4)',
        [link, source, userAgent, referer],
      );
    },

    async statsByLink() {
      const { rows } = await pool.query(
        `SELECT link, source, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int  AS last7,
                COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS last30,
                MAX(created_at) AS last_click_at
         FROM social_clicks GROUP BY link, source ORDER BY total DESC`,
      );
      return rows.map((row) => ({
        link: row.link,
        source: row.source,
        total: row.total,
        last7: row.last7,
        last30: row.last30,
        lastClickAt: row.last_click_at.toISOString(),
      }));
    },
  };
}
