import bcrypt from 'bcryptjs';
import { verify } from 'hono/jwt';
import { beforeEach, describe, expect, it } from 'vitest';
import { AuthService, createAuthService } from '../src/services/auth.service';
import { DomainError } from '../src/types';
import { FakeUsersRepo } from './fakes';

const SECRET = 'test-secret';

describe('AuthService', () => {
  let users: FakeUsersRepo;
  let auth: AuthService;

  beforeEach(() => {
    users = new FakeUsersRepo();
    auth = createAuthService({ users, jwtSecret: SECRET });
  });

  it('registers a user and returns a verifiable token + public user', async () => {
    const { token, user } = await auth.register({
      email: 'aanya@example.com',
      password: 'Aanya@2026',
      firstName: 'Aanya',
      lastName: 'Mehra',
    });
    expect(user).toEqual({
      id: expect.any(String),
      email: 'aanya@example.com',
      firstName: 'Aanya',
      lastName: 'Mehra',
      role: 'customer',
    });
    expect(user).not.toHaveProperty('passwordHash');

    const payload = await verify(token, SECRET, 'HS256');
    expect(payload.sub).toBe(user.id);
    expect(payload.email).toBe('aanya@example.com');
    expect(payload.role).toBe('customer');
    // ~7 day expiry
    const sevenDays = 7 * 24 * 60 * 60;
    expect(Number(payload.exp) - Math.floor(Date.now() / 1000)).toBeGreaterThan(sevenDays - 60);
    expect(Number(payload.exp) - Math.floor(Date.now() / 1000)).toBeLessThanOrEqual(sevenDays);
  });

  it('stores a bcrypt hash, never the plain password', async () => {
    await auth.register({ email: 'a@b.com', password: 'Secret@123', firstName: 'A' });
    const stored = users.users[0];
    expect(stored.passwordHash).not.toBe('Secret@123');
    expect(await bcrypt.compare('Secret@123', stored.passwordHash)).toBe(true);
  });

  it('normalizes email to lowercase on register', async () => {
    const { user } = await auth.register({ email: '  Aanya@Example.COM ', password: 'Aanya@2026', firstName: 'Aanya' });
    expect(user.email).toBe('aanya@example.com');
  });

  it('rejects duplicate emails with EMAIL_TAKEN (case-insensitive)', async () => {
    await auth.register({ email: 'aanya@example.com', password: 'Aanya@2026', firstName: 'Aanya' });
    await expect(
      auth.register({ email: 'AANYA@example.com', password: 'Other@2026', firstName: 'X' }),
    ).rejects.toMatchObject({ code: 'EMAIL_TAKEN' });
  });

  it('logs in with correct credentials (case-insensitive email)', async () => {
    await auth.register({ email: 'aanya@example.com', password: 'Aanya@2026', firstName: 'Aanya' });
    const { token, user } = await auth.login({ email: 'Aanya@Example.com', password: 'Aanya@2026' });
    expect(user.email).toBe('aanya@example.com');
    expect((await verify(token, SECRET, 'HS256')).sub).toBe(user.id);
  });

  it('rejects a wrong password with INVALID_CREDENTIALS', async () => {
    await auth.register({ email: 'aanya@example.com', password: 'Aanya@2026', firstName: 'Aanya' });
    await expect(auth.login({ email: 'aanya@example.com', password: 'wrong' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('rejects an unknown email with INVALID_CREDENTIALS', async () => {
    await expect(auth.login({ email: 'ghost@example.com', password: 'whatever' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('getUser returns the public user', async () => {
    const { user } = await auth.register({ email: 'a@b.com', password: 'Secret@123', firstName: 'A', lastName: 'B' });
    expect(await auth.getUser(user.id)).toEqual(user);
  });

  it('getUser throws NOT_FOUND for an unknown id', async () => {
    await expect(auth.getUser('nope')).rejects.toMatchObject({ code: 'NOT_FOUND' });
    await expect(auth.getUser('nope')).rejects.toBeInstanceOf(DomainError);
  });
});
