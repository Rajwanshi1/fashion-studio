import bcrypt from 'bcryptjs';
import { sign } from 'hono/jwt';
import type { UsersRepo } from '../data/users.repo';
import { DomainError, PublicUser, User } from '../types';

export interface RegisterInput {
  email: string;
  password: string;
  firstName: string;
  lastName?: string;
}

export interface AuthService {
  register(input: RegisterInput): Promise<{ token: string; user: PublicUser }>;
  login(input: { email: string; password: string }): Promise<{ token: string; user: PublicUser }>;
  getUser(id: string): Promise<PublicUser>;
}

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;

function toPublic(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    firstName: user.firstName,
    lastName: user.lastName,
    role: user.role,
  };
}

export function createAuthService(deps: { users: UsersRepo; jwtSecret: string }): AuthService {
  function issueToken(user: User): Promise<string> {
    // HS256 (hono/jwt default), 7-day expiry.
    return sign(
      { sub: user.id, email: user.email, role: user.role, exp: Math.floor(Date.now() / 1000) + SEVEN_DAYS_S },
      deps.jwtSecret,
    );
  }

  return {
    async register({ email, password, firstName, lastName = '' }) {
      const normalized = email.trim().toLowerCase();
      if (await deps.users.findByEmail(normalized)) {
        throw new DomainError('EMAIL_TAKEN', 'An account with this email already exists');
      }
      const passwordHash = await bcrypt.hash(password, 10);
      const user = await deps.users.create({ email: normalized, passwordHash, firstName, lastName, role: 'customer' });
      return { token: await issueToken(user), user: toPublic(user) };
    },

    async login({ email, password }) {
      const user = await deps.users.findByEmail(email.trim().toLowerCase());
      if (!user || !(await bcrypt.compare(password, user.passwordHash))) {
        throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password');
      }
      return { token: await issueToken(user), user: toPublic(user) };
    },

    async getUser(id) {
      const user = await deps.users.findById(id);
      if (!user) throw new DomainError('NOT_FOUND', 'User not found');
      return toPublic(user);
    },
  };
}
