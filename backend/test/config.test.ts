import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

const VALID_SECRET = 'a'.repeat(32);
const SHORT_SECRET = 'a'.repeat(31);

describe('loadConfig', () => {
  describe('production', () => {
    it('throws when JWT_SECRET is unset', () => {
      expect(() => loadConfig({ NODE_ENV: 'production' })).toThrow(/JWT_SECRET/);
    });

    it('throws when JWT_SECRET is the default dev secret', () => {
      expect(() =>
        loadConfig({ NODE_ENV: 'production', JWT_SECRET: 'dev-secret-change-in-prod' })
      ).toThrow(/JWT_SECRET/);
    });

    it('throws when JWT_SECRET is shorter than 32 characters', () => {
      expect(() => loadConfig({ NODE_ENV: 'production', JWT_SECRET: SHORT_SECRET })).toThrow(
        /JWT_SECRET/
      );
    });

    it('loads when JWT_SECRET is exactly 32 characters', () => {
      const config = loadConfig({ NODE_ENV: 'production', JWT_SECRET: VALID_SECRET });
      expect(config.jwtSecret).toBe(VALID_SECRET);
      expect(config.nodeEnv).toBe('production');
    });

    it('throws when SEED_ON_START=true, even with a valid secret', () => {
      expect(() =>
        loadConfig({
          NODE_ENV: 'production',
          JWT_SECRET: VALID_SECRET,
          SEED_ON_START: 'true',
        })
      ).toThrow(/SEED_ON_START/);
    });

    it('defaults paymentProvider to disabled (fail-closed)', () => {
      const config = loadConfig({ NODE_ENV: 'production', JWT_SECRET: VALID_SECRET });
      expect(config.paymentProvider).toBe('disabled');
    });

    it('throws for PAYMENT_PROVIDER=mock without the ALLOW_MOCK_PAYMENTS escape hatch', () => {
      expect(() =>
        loadConfig({ NODE_ENV: 'production', JWT_SECRET: VALID_SECRET, PAYMENT_PROVIDER: 'mock' })
      ).toThrow(/PAYMENT_PROVIDER=mock is not allowed/);
    });

    it('loads PAYMENT_PROVIDER=mock with ALLOW_MOCK_PAYMENTS=true (staging)', () => {
      const config = loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: VALID_SECRET,
        PAYMENT_PROVIDER: 'mock',
        ALLOW_MOCK_PAYMENTS: 'true',
      });
      expect(config.paymentProvider).toBe('mock');
    });

    it('loads PAYMENT_PROVIDER=disabled', () => {
      const config = loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: VALID_SECRET,
        PAYMENT_PROVIDER: 'disabled',
      });
      expect(config.paymentProvider).toBe('disabled');
    });

    it('throws on an unknown PAYMENT_PROVIDER value', () => {
      expect(() =>
        loadConfig({ NODE_ENV: 'production', JWT_SECRET: VALID_SECRET, PAYMENT_PROVIDER: 'razorpay' })
      ).toThrow(/PAYMENT_PROVIDER/);
    });

    it('defaults whatsappProvider to disabled (fail-closed)', () => {
      const config = loadConfig({ NODE_ENV: 'production', JWT_SECRET: VALID_SECRET });
      expect(config.whatsappProvider).toBe('disabled');
    });

    it('throws for WHATSAPP_PROVIDER=console without the ALLOW_CONSOLE_WHATSAPP escape hatch', () => {
      expect(() =>
        loadConfig({ NODE_ENV: 'production', JWT_SECRET: VALID_SECRET, WHATSAPP_PROVIDER: 'console' })
      ).toThrow(/WHATSAPP_PROVIDER=console is not allowed/);
    });

    it('loads WHATSAPP_PROVIDER=console with ALLOW_CONSOLE_WHATSAPP=true (staging)', () => {
      const config = loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: VALID_SECRET,
        WHATSAPP_PROVIDER: 'console',
        ALLOW_CONSOLE_WHATSAPP: 'true',
      });
      expect(config.whatsappProvider).toBe('console');
    });

    it('throws for WHATSAPP_PROVIDER=meta without credentials', () => {
      expect(() =>
        loadConfig({ NODE_ENV: 'production', JWT_SECRET: VALID_SECRET, WHATSAPP_PROVIDER: 'meta' })
      ).toThrow(/WHATSAPP_ACCESS_TOKEN and WHATSAPP_PHONE_NUMBER_ID/);
    });

    it('loads WHATSAPP_PROVIDER=meta with credentials', () => {
      const config = loadConfig({
        NODE_ENV: 'production',
        JWT_SECRET: VALID_SECRET,
        WHATSAPP_PROVIDER: 'meta',
        WHATSAPP_ACCESS_TOKEN: ' token ',
        WHATSAPP_PHONE_NUMBER_ID: ' 1234567890 ',
      });
      expect(config.whatsappProvider).toBe('meta');
      expect(config.whatsappAccessToken).toBe('token');
      expect(config.whatsappPhoneNumberId).toBe('1234567890');
    });

    it('throws on an unknown WHATSAPP_PROVIDER value', () => {
      expect(() =>
        loadConfig({ NODE_ENV: 'production', JWT_SECRET: VALID_SECRET, WHATSAPP_PROVIDER: 'twilio' })
      ).toThrow(/WHATSAPP_PROVIDER/);
    });
  });

  describe('development', () => {
    it('loads with the fallback secret and seedOnStart false when no env is set', () => {
      const config = loadConfig({});
      expect(config.nodeEnv).toBe('development');
      expect(config.jwtSecret).toBe('dev-secret-change-in-prod');
      expect(config.seedOnStart).toBe(false);
    });

    it('loads when SEED_ON_START=true', () => {
      const config = loadConfig({ SEED_ON_START: 'true' });
      expect(config.seedOnStart).toBe(true);
    });

    it('defaults paymentProvider to mock', () => {
      expect(loadConfig({}).paymentProvider).toBe('mock');
    });

    it('honours PAYMENT_PROVIDER=disabled', () => {
      expect(loadConfig({ PAYMENT_PROVIDER: 'disabled' }).paymentProvider).toBe('disabled');
    });

    it('defaults whatsappProvider to console', () => {
      expect(loadConfig({}).whatsappProvider).toBe('console');
    });
  });
});
