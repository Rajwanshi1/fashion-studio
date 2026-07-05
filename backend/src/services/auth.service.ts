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

/** Claims we need from a verified Google ID token. */
export interface GoogleTokenClaims {
  email: string;
  givenName: string;
  familyName: string;
}

/**
 * Verifies a Google ID token (the GIS `credential`) and returns its claims.
 * Rejects/throws on any invalid, expired or mis-audienced token. The real
 * jose-backed implementation lives in google.verifier.ts; tests inject a fake.
 */
export type VerifyGoogleToken = (credential: string) => Promise<GoogleTokenClaims>;

export interface AuthService {
  register(input: RegisterInput): Promise<{ token: string; user: PublicUser }>;
  login(input: { email: string; password: string }): Promise<{ token: string; user: PublicUser }>;
  loginWithGoogle(credential: string): Promise<{ token: string; user: PublicUser }>;
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

export function createAuthService(deps: {
  users: UsersRepo;
  jwtSecret: string;
  /** Masked until GOOGLE_CLIENT_ID exists — null/undefined means Google sign-in is not configured. */
  verifyGoogleToken?: VerifyGoogleToken | null;
}): AuthService {
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
      // Google-only accounts have no password hash — treat as bad credentials, never crash.
      if (!user || !user.passwordHash || !(await bcrypt.compare(password, user.passwordHash))) {
        throw new DomainError('INVALID_CREDENTIALS', 'Invalid email or password');
      }
      return { token: await issueToken(user), user: toPublic(user) };
    },

    async loginWithGoogle(credential) {
      if (!deps.verifyGoogleToken) {
        throw new DomainError('NOT_CONFIGURED', 'Google sign-in is not configured yet');
      }
      let claims: GoogleTokenClaims;
      try {
        claims = await deps.verifyGoogleToken(credential);
      } catch {
        throw new DomainError('INVALID_CREDENTIALS', 'Google sign-in failed');
      }
      const email = claims.email.trim().toLowerCase();
      // Upsert by email: existing accounts (any provider) just log in.
      let user = await deps.users.findByEmail(email);
      if (!user) {
        user = await deps.users.create({
          email,
          passwordHash: null,
          firstName: claims.givenName ?? '',
          lastName: claims.familyName ?? '',
          role: 'customer',
          authProvider: 'google',
        });
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
