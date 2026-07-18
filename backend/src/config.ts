export interface Config {
  nodeEnv: string;
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigins: string[];
  seedOnStart: boolean;
  /** Null keeps Google sign-in masked (endpoint answers 503). */
  googleClientId: string | null;
  /** 'disabled' keeps checkout/confirm masked (both answer 503). */
  paymentProvider: 'mock' | 'disabled';
}

const DEV_JWT_SECRET = 'dev-secret-change-in-prod';

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  const nodeEnv = env.NODE_ENV ?? 'development';
  const jwtSecret = env.JWT_SECRET ?? DEV_JWT_SECRET;
  const seedOnStart = env.SEED_ON_START === 'true';

  // Fail-closed: an unset PAYMENT_PROVIDER means disabled in production.
  const paymentProvider = env.PAYMENT_PROVIDER ?? (nodeEnv === 'production' ? 'disabled' : 'mock');
  if (paymentProvider !== 'mock' && paymentProvider !== 'disabled') {
    throw new Error(`PAYMENT_PROVIDER must be 'mock' or 'disabled', got '${paymentProvider}'`);
  }

  if (nodeEnv === 'production') {
    if (!env.JWT_SECRET || env.JWT_SECRET === DEV_JWT_SECRET || env.JWT_SECRET.length < 32) {
      throw new Error(
        'JWT_SECRET must be set to a random value of at least 32 chars in production, ' +
          'e.g. `openssl rand -hex 32`'
      );
    }
    if (seedOnStart) {
      throw new Error(
        'SEED_ON_START must not be true in production: seeding creates a known-password ' +
          'admin account; set SEED_ON_START=false'
      );
    }
    // Staging deliberately runs NODE_ENV=production with the mock provider, so
    // it must set the explicit ALLOW_MOCK_PAYMENTS=true escape hatch. A real
    // production environment must use PAYMENT_PROVIDER=disabled until the
    // Razorpay integration lands.
    if (paymentProvider === 'mock' && env.ALLOW_MOCK_PAYMENTS !== 'true') {
      throw new Error(
        'PAYMENT_PROVIDER=mock is not allowed in production (the mock trusts client-supplied ' +
          'payment outcomes). Set PAYMENT_PROVIDER=disabled, or set ALLOW_MOCK_PAYMENTS=true ' +
          'only on staging.'
      );
    }
  }

  return {
    nodeEnv,
    port: parseInt(env.PORT ?? '3001', 10),
    databaseUrl: env.DATABASE_URL ?? 'postgres://boutique:boutique@localhost:5433/boutique',
    jwtSecret,
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    seedOnStart,
    googleClientId: env.GOOGLE_CLIENT_ID?.trim() || null,
    paymentProvider,
  };
}
