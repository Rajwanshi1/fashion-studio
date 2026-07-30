import bcrypt from 'bcryptjs';
import { createHash, randomInt } from 'node:crypto';
import { sign } from 'hono/jwt';
import type { OtpsRepo } from '../data/otps.repo';
import type { UsersRepo } from '../data/users.repo';
import { normalizePhone } from '../lib/phone';
import type { SmsProvider } from './sms.provider';
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
  requestOtp(phone: string): Promise<{ phone: string }>;
  verifyOtp(input: { phone: string; code: string }): Promise<{ token: string; user: PublicUser }>;
  getUser(id: string): Promise<PublicUser>;
}

const SEVEN_DAYS_S = 7 * 24 * 60 * 60;
const OTP_TTL_MS = 5 * 60_000;
const OTP_SEND_WINDOW_MS = 10 * 60_000;
const OTP_MAX_SENDS = 3;
const OTP_MAX_ATTEMPTS = 3;

function toPublic(user: User): PublicUser {
  return {
    id: user.id,
    email: user.email,
    phone: user.phone,
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
  otps?: OtpsRepo;
  /** Masked SMS seam — null/undefined means phone-OTP login is not configured (503). */
  smsProvider?: SmsProvider | null;
  /** Fixed code for dev/e2e; pair only with the console provider. */
  otpDevCode?: string | null;
  /** Injectable clock for tests. */
  now?: () => Date;
}): AuthService {
  function issueToken(user: User): Promise<string> {
    // HS256 (hono/jwt default), 7-day expiry.
    return sign(
      { sub: user.id, email: user.email ?? '', role: user.role, exp: Math.floor(Date.now() / 1000) + SEVEN_DAYS_S },
      deps.jwtSecret,
    );
  }

  // Peppered with the JWT secret so a leaked phone_otps table alone can't be brute-forced offline.
  function hashOtp(code: string, phone: string): string {
    return createHash('sha256').update(`${code}:${phone}:${deps.jwtSecret}`).digest('hex');
  }

  const clock = deps.now ?? (() => new Date());

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

    async requestOtp(rawPhone) {
      const phone = normalizePhone(rawPhone);
      if (!phone) throw new DomainError('INVALID_PHONE', 'Enter a valid mobile number');
      if (!deps.smsProvider || !deps.otps) {
        throw new DomainError('NOT_CONFIGURED', 'Phone login is not configured yet');
      }
      const now = clock();
      const since = new Date(now.getTime() - OTP_SEND_WINDOW_MS);
      if ((await deps.otps.countRecentForPhone(phone, since)) >= OTP_MAX_SENDS) {
        throw new DomainError('TOO_MANY_REQUESTS', 'Too many codes requested — try again in a few minutes');
      }
      const code = deps.otpDevCode ?? String(randomInt(0, 1_000_000)).padStart(6, '0');
      await deps.otps.create({
        phone,
        codeHash: hashOtp(code, phone),
        expiresAt: new Date(now.getTime() + OTP_TTL_MS),
      });
      await deps.smsProvider.sendOtp(phone, code);
      return { phone };
    },

    async verifyOtp({ phone: rawPhone, code }) {
      const phone = normalizePhone(rawPhone);
      if (!phone) throw new DomainError('INVALID_PHONE', 'Enter a valid mobile number');
      if (!deps.smsProvider || !deps.otps) {
        throw new DomainError('NOT_CONFIGURED', 'Phone login is not configured yet');
      }
      const invalid = () =>
        new DomainError('INVALID_CREDENTIALS', 'Code incorrect or expired — request a new one');
      const record = await deps.otps.latestActiveForPhone(phone, clock());
      if (!record) throw invalid();
      const attempts = await deps.otps.incrementAttempts(record.id);
      if (attempts > OTP_MAX_ATTEMPTS || hashOtp(code, phone) !== record.codeHash) {
        if (attempts >= OTP_MAX_ATTEMPTS) await deps.otps.consume(record.id);
        throw invalid();
      }
      await deps.otps.consume(record.id);

      // Upsert by phone: offline-created accounts get verified on first login.
      let user = await deps.users.findByPhone(phone);
      if (!user) {
        user = await deps.users.create({
          email: null,
          passwordHash: null,
          firstName: '',
          lastName: '',
          role: 'customer',
          authProvider: 'otp',
          phone,
          phoneVerified: true,
        });
      } else if (!user.phoneVerified) {
        user = (await deps.users.setPhoneVerified(user.id)) ?? user;
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
