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
  });
});
