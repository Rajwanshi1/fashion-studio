import { Pool } from 'pg';

export interface OtpRecord {
  id: string;
  phone: string;
  codeHash: string;
  expiresAt: Date;
  attempts: number;
}

export interface OtpsRepo {
  create(input: { phone: string; codeHash: string; expiresAt: Date }): Promise<OtpRecord>;
  /** Newest unconsumed, unexpired code for a phone. */
  latestActiveForPhone(phone: string, now: Date): Promise<OtpRecord | null>;
  /** Returns the post-increment attempt count. */
  incrementAttempts(id: string): Promise<number>;
  consume(id: string): Promise<void>;
  /** Codes created for a phone since `since` — send-throttle input. */
  countRecentForPhone(phone: string, since: Date): Promise<number>;
}

function mapOtp(row: any): OtpRecord {
  return {
    id: row.id,
    phone: row.phone,
    codeHash: row.code_hash,
    expiresAt: row.expires_at,
    attempts: row.attempts,
  };
}

export function createOtpsRepo(pool: Pool): OtpsRepo {
  return {
    async create({ phone, codeHash, expiresAt }) {
      const { rows } = await pool.query(
        `INSERT INTO phone_otps (phone, code_hash, expires_at) VALUES ($1, $2, $3) RETURNING *`,
        [phone, codeHash, expiresAt],
      );
      return mapOtp(rows[0]);
    },

    async latestActiveForPhone(phone, now) {
      const { rows } = await pool.query(
        `SELECT * FROM phone_otps
         WHERE phone = $1 AND consumed_at IS NULL AND expires_at > $2
         ORDER BY created_at DESC LIMIT 1`,
        [phone, now],
      );
      return rows[0] ? mapOtp(rows[0]) : null;
    },

    async incrementAttempts(id) {
      const { rows } = await pool.query(
        `UPDATE phone_otps SET attempts = attempts + 1 WHERE id = $1 RETURNING attempts`,
        [id],
      );
      return rows[0]?.attempts ?? Number.MAX_SAFE_INTEGER;
    },

    async consume(id) {
      await pool.query(`UPDATE phone_otps SET consumed_at = now() WHERE id = $1`, [id]);
    },

    async countRecentForPhone(phone, since) {
      const { rows } = await pool.query(
        `SELECT count(*)::int AS n FROM phone_otps WHERE phone = $1 AND created_at > $2`,
        [phone, since],
      );
      return rows[0].n;
    },
  };
}
