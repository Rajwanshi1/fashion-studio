import { Pool } from 'pg';

export interface SourceStats {
  source: string;
  total: number;
  last7: number;
  last30: number;
  lastScanAt: string;
}

export interface ScansRepo {
  insert(source: string, userAgent: string | null, referer: string | null): Promise<void>;
  statsBySource(): Promise<SourceStats[]>;
}

export function createScansRepo(pool: Pool): ScansRepo {
  return {
    async insert(source, userAgent, referer) {
      await pool.query(
        'INSERT INTO social_scans (source, user_agent, referer) VALUES ($1,$2,$3)',
        [source, userAgent, referer],
      );
    },

    async statsBySource() {
      const { rows } = await pool.query(
        `SELECT source, COUNT(*)::int AS total,
                COUNT(*) FILTER (WHERE created_at > now() - interval '7 days')::int  AS last7,
                COUNT(*) FILTER (WHERE created_at > now() - interval '30 days')::int AS last30,
                MAX(created_at) AS last_scan_at
         FROM social_scans GROUP BY source ORDER BY total DESC`,
      );
      return rows.map((row) => ({
        source: row.source,
        total: row.total,
        last7: row.last7,
        last30: row.last30,
        lastScanAt: row.last_scan_at.toISOString(),
      }));
    },
  };
}
