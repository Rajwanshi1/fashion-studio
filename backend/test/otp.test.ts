import { verify } from 'hono/jwt';
import { beforeEach, describe, expect, it } from 'vitest';
import { normalizePhone } from '../src/lib/phone';
import { AuthService, createAuthService } from '../src/services/auth.service';
import { FakeOtpsRepo, FakeSmsProvider, FakeUsersRepo } from './fakes';

const SECRET = 'test-secret';
const DEV_CODE = '123456';

describe('normalizePhone', () => {
  it.each([
    ['9876543210', '+919876543210'],
    ['09876543210', '+919876543210'],
    ['919876543210', '+919876543210'],
    ['+91 98765 43210', '+919876543210'],
    ['98765-43210', '+919876543210'],
    ['+1 415 555 2671', '+14155552671'],
  ])('normalizes %s → %s', (raw, expected) => {
    expect(normalizePhone(raw)).toBe(expected);
  });

  it.each([
    [''],
    ['12345'],
    ['1234567890'], // 10 digits but not a mobile prefix (6-9)
    ['not-a-number'],
    ['+12'],
    ['98765432101234'],
  ])('rejects %s', (raw) => {
    expect(normalizePhone(raw)).toBeNull();
  });
});

describe('phone OTP login', () => {
  let users: FakeUsersRepo;
  let otps: FakeOtpsRepo;
  let sms: FakeSmsProvider;
  let auth: AuthService;
  let t: Date;

  beforeEach(() => {
    users = new FakeUsersRepo();
    otps = new FakeOtpsRepo();
    sms = new FakeSmsProvider();
    t = new Date('2026-07-24T10:00:00Z');
    auth = createAuthService({
      users,
      jwtSecret: SECRET,
      otps,
      smsProvider: sms,
      otpDevCode: DEV_CODE,
      now: () => t,
    });
  });

  it('throws NOT_CONFIGURED from both endpoints when no SMS provider is wired', async () => {
    const masked = createAuthService({ users, jwtSecret: SECRET, otps, smsProvider: null });
    await expect(masked.requestOtp('9876543210')).rejects.toMatchObject({ code: 'NOT_CONFIGURED' });
    await expect(masked.verifyOtp({ phone: '9876543210', code: DEV_CODE })).rejects.toMatchObject({
      code: 'NOT_CONFIGURED',
    });
  });

  it('rejects an unnormalizable phone with INVALID_PHONE before touching the provider', async () => {
    await expect(auth.requestOtp('12345')).rejects.toMatchObject({ code: 'INVALID_PHONE' });
    expect(sms.sent).toHaveLength(0);
  });

  it('sends a 6-digit code to the normalized number', async () => {
    const random = createAuthService({ users, jwtSecret: SECRET, otps, smsProvider: sms });
    const { phone } = await random.requestOtp('98765 43210');
    expect(phone).toBe('+919876543210');
    expect(sms.sent).toHaveLength(1);
    expect(sms.sent[0].phone).toBe('+919876543210');
    expect(sms.sent[0].code).toMatch(/^\d{6}$/);
  });

  it('verify creates a new verified customer (provider otp, null email) and issues a working JWT', async () => {
    await auth.requestOtp('9876543210');
    const { token, user } = await auth.verifyOtp({ phone: '+91 9876543210', code: DEV_CODE });
    expect(user).toEqual({
      id: expect.any(String),
      email: null,
      phone: '+919876543210',
      firstName: '',
      lastName: '',
      role: 'customer',
    });
    const stored = users.users[0];
    expect(stored.authProvider).toBe('otp');
    expect(stored.phoneVerified).toBe(true);
    expect(stored.passwordHash).toBeNull();
    const payload = await verify(token, SECRET, 'HS256');
    expect(payload.sub).toBe(user.id);
    expect(payload.role).toBe('customer');
  });

  it('logs an existing phone user in without duplicating, marking the phone verified', async () => {
    const existing = await users.create({
      email: null,
      passwordHash: null,
      firstName: 'Meera',
      lastName: 'Shah',
      role: 'customer',
      authProvider: 'otp',
      phone: '+919876543210',
      phoneVerified: false,
    });
    await auth.requestOtp('9876543210');
    const { user } = await auth.verifyOtp({ phone: '09876543210', code: DEV_CODE });
    expect(user.id).toBe(existing.id);
    expect(user.firstName).toBe('Meera');
    expect(users.users).toHaveLength(1);
    expect(users.users[0].phoneVerified).toBe(true);
  });

  it('a wrong code fails; the right code within 3 total attempts still succeeds', async () => {
    await auth.requestOtp('9876543210');
    await expect(auth.verifyOtp({ phone: '9876543210', code: '999999' })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
    const { user } = await auth.verifyOtp({ phone: '9876543210', code: DEV_CODE });
    expect(user.phone).toBe('+919876543210');
  });

  it('3 failed attempts consume the code — the right code no longer works', async () => {
    await auth.requestOtp('9876543210');
    for (let i = 0; i < 3; i++) {
      await expect(auth.verifyOtp({ phone: '9876543210', code: '999999' })).rejects.toMatchObject({
        code: 'INVALID_CREDENTIALS',
      });
    }
    await expect(auth.verifyOtp({ phone: '9876543210', code: DEV_CODE })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('a consumed code cannot be replayed', async () => {
    await auth.requestOtp('9876543210');
    await auth.verifyOtp({ phone: '9876543210', code: DEV_CODE });
    await expect(auth.verifyOtp({ phone: '9876543210', code: DEV_CODE })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('codes expire after 5 minutes', async () => {
    await auth.requestOtp('9876543210');
    t = new Date(t.getTime() + 6 * 60_000);
    await expect(auth.verifyOtp({ phone: '9876543210', code: DEV_CODE })).rejects.toMatchObject({
      code: 'INVALID_CREDENTIALS',
    });
  });

  it('throttles to 3 sends per phone per 10 minutes, recovering after the window', async () => {
    for (let i = 0; i < 3; i++) await auth.requestOtp('9876543210');
    await expect(auth.requestOtp('9876543210')).rejects.toMatchObject({ code: 'TOO_MANY_REQUESTS' });
    // A different phone is unaffected.
    await auth.requestOtp('9123456789');
    t = new Date(t.getTime() + 11 * 60_000);
    await expect(auth.requestOtp('9876543210')).resolves.toEqual({ phone: '+919876543210' });
  });
});
