import { Pool } from 'pg';
import { DomainError, Role, User } from '../types';

export interface CreateUserInput {
  email: string;
  passwordHash: string;
  firstName: string;
  lastName: string;
  role?: Role;
}

export interface UsersRepo {
  create(input: CreateUserInput): Promise<User>;
  findByEmail(email: string): Promise<User | null>;
  findById(id: string): Promise<User | null>;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function mapUser(row: any): User {
  return {
    id: row.id,
    email: row.email,
    passwordHash: row.password_hash,
    firstName: row.first_name,
    lastName: row.last_name,
    role: row.role,
  };
}

export function createUsersRepo(pool: Pool): UsersRepo {
  return {
    async create(input) {
      try {
        const { rows } = await pool.query(
          `INSERT INTO users (email, password_hash, first_name, last_name, role)
           VALUES ($1, $2, $3, $4, $5) RETURNING *`,
          [input.email, input.passwordHash, input.firstName, input.lastName, input.role ?? 'customer'],
        );
        return mapUser(rows[0]);
      } catch (err: any) {
        if (err?.code === '23505') {
          throw new DomainError('EMAIL_TAKEN', 'An account with this email already exists');
        }
        throw err;
      }
    },

    async findByEmail(email) {
      const { rows } = await pool.query('SELECT * FROM users WHERE lower(email) = lower($1)', [email]);
      return rows[0] ? mapUser(rows[0]) : null;
    },

    async findById(id) {
      if (!UUID_RE.test(id)) return null;
      const { rows } = await pool.query('SELECT * FROM users WHERE id = $1', [id]);
      return rows[0] ? mapUser(rows[0]) : null;
    },
  };
}
