import { Pool } from 'pg';
import { AuthProvider, DomainError, Role, User } from '../types';

export interface CreateUserInput {
  email: string | null;
  passwordHash: string | null;
  firstName: string;
  lastName: string;
  role?: Role;
  authProvider?: AuthProvider;
  /** E.164; must be pre-normalized by the caller. */
  phone?: string | null;
  phoneVerified?: boolean;
}

/** Row shape for the admin user-management screens. */
export interface AdminUser {
  id: string;
  email: string | null;
  phone: string | null;
  firstName: string;
  lastName: string;
  role: Role;
  authProvider: AuthProvider;
  createdAt: string;
  ordersCount: number;
}

export interface UsersRepo {
  create(input: CreateUserInput): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  findByPhone(phone: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
  setPhoneVerified(id: string): Promise<User | null>;
  listAdmin(): Promise<AdminUser[]>;
  /**
   * Candidate lookup for linking offline bills: exact normalized-phone matches
   * rank first, then email/name ILIKE matches. Limit 8.
   */
  searchAdmin(phone?: string | null, q?: string | null): Promise<AdminUser[]>;
  updateRole(id: string, role: Role): Promise<AdminUser | null>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapUser(row: any): User {
  return {
    id: row.id,
    email: row.email ?? null,
    passwordHash: row.password_hash ?? null,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    authProvider: row.auth_provider,
    phone: row.phone ?? null,
    phoneVerified: row.phone_verified ?? false,
    createdAt: row.created_at.toISOString(),
  };
}

function mapAdminUser(row: any): AdminUser {
  return {
    id: row.id,
    email: row.email ?? null,
    phone: row.phone ?? null,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
    authProvider: row.auth_provider,
    createdAt: row.created_at.toISOString(),
    ordersCount: Number(row.orders_count),
  };
}

export function createUsersRepo(pool: Pool): UsersRepo {
  return {
    async create(input) {
      try {
        const { rows } = await pool.query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role, auth_provider, phone, phone_verified)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8) RETURNING *`,
          [
            input.email,
            input.passwordHash,
            input.firstName,
            input.lastName,
            input.role ?? 'customer',
            input.authProvider ?? 'password',
            input.phone ?? null,
            input.phoneVerified ?? false,
          ],
        );
        return mapUser(rows[0]);
      } catch (err: any) {
        if (err?.code === '23505') {
          if (err?.constraint === 'users_phone_unique') {
            throw new DomainError('PHONE_TAKEN', 'An account with this phone number already exists');
          }
          throw new DomainError('EMAIL_TAKEN', 'An account with this email already exists');
        }
        throw err;
      }
    },

    async findByEmail(email) {
      const { rows } = await pool.query(
        'SELECT * FROM users WHERE email IS NOT NULL AND lower(email) = lower($1)',
        [email],
      );
      return rows[0] ? mapUser(rows[0]) : null;
    },

    async findByPhone(phone) {
      const { rows } = await pool.query('SELECT * FROM users WHERE phone = $1', [phone]);
      return rows[0] ? mapUser(rows[0]) : null;
    },

    async setPhoneVerified(id) {
      if (!UUID_RE.test(id)) return null;
      const { rows } = await pool.query('UPDATE users SET phone_verified = true WHERE id = $1 RETURNING *', [id]);
      return rows[0] ? mapUser(rows[0]) : null;
    },

    async findById(id) {
      if (!UUID_RE.test(id)) return null;
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return rows[0] ? mapUser(rows[0]) : null;
    },

    async listAdmin() {
      const { rows } = await pool.query(
        `SELECT u.id, u.email, u.phone, u.first_name, u.last_name, u.role, u.auth_provider, u.created_at,
                count(o.id)::int AS orders_count
         FROM users u
         LEFT JOIN orders o ON o.user_id = u.id
         GROUP BY u.id
         ORDER BY u.created_at DESC`,
      );
      return rows.map(mapAdminUser);
    },

    async searchAdmin(phone, q) {
      const conditions: string[] = [];
      const params: unknown[] = [];
      if (phone) {
        params.push(phone);
        conditions.push(`u.phone = $${params.length}`);
      }
      if (q) {
        params.push(`%${q}%`);
        const p = `$${params.length}`;
        conditions.push(`(u.email ILIKE ${p} OR u.first_name ILIKE ${p} OR u.last_name ILIKE ${p})`);
      }
      if (conditions.length === 0) return [];
      const phoneRank = phone ? `(u.phone = $1) DESC, ` : '';
      const { rows } = await pool.query(
        `SELECT u.id, u.email, u.phone, u.first_name, u.last_name, u.role, u.auth_provider, u.created_at,
                count(o.id)::int AS orders_count
         FROM users u
         LEFT JOIN orders o ON o.user_id = u.id
         WHERE ${conditions.join(' OR ')}
         GROUP BY u.id
         ORDER BY ${phoneRank}u.created_at DESC
         LIMIT 8`,
        params,
      );
      return rows.map(mapAdminUser);
    },

    async updateRole(id, role) {
      if (!UUID_RE.test(id)) return null;
      const { rows } = await pool.query(
        `UPDATE users SET role = $2 WHERE id = $1
         RETURNING *, (SELECT count(*)::int FROM orders o WHERE o.user_id = users.id) AS orders_count`,
        [id, role],
      );
      return rows[0] ? mapAdminUser(rows[0]) : null;
    },
  };
}
