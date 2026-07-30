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
  /** 'disabled' keeps phone-OTP login masked (endpoints answer 503). */
  smsProvider: 'msg91' | 'console' | 'disabled';
  msg91AuthKey: string | null;
  msg91TemplateId: string | null;
  /** Fixed OTP for dev/e2e. Only honored alongside the console provider. */
  otpDevCode: string | null;
  /** Null keeps document parsing masked (parse endpoint answers 503). */
  anthropicApiKey: string | null;
  /** Null means no S3 — the dev LocalObjectStore serves uploads instead. */
  s3UploadsBucket: string | null;
  /** LocalObjectStore directory (dev only; ignored when S3 is configured). */
  uploadsDir: string;
  /** Public base URL of this API — the LocalObjectStore presigns against it. */
  publicApiUrl: string;
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

  // Fail-closed: an unset SMS_PROVIDER means disabled in production.
  const smsProvider = env.SMS_PROVIDER ?? (nodeEnv === 'production' ? 'disabled' : 'console');
  if (smsProvider !== 'msg91' && smsProvider !== 'console' && smsProvider !== 'disabled') {
    throw new Error(`SMS_PROVIDER must be 'msg91', 'console' or 'disabled', got '${smsProvider}'`);
  }
  if (smsProvider === 'msg91' && (!env.MSG91_AUTH_KEY || !env.MSG91_TEMPLATE_ID)) {
    throw new Error('SMS_PROVIDER=msg91 requires MSG91_AUTH_KEY and MSG91_TEMPLATE_ID');
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
    if (smsProvider === 'console' && env.ALLOW_CONSOLE_OTP !== 'true') {
      throw new Error(
        'SMS_PROVIDER=console is not allowed in production (OTP codes are printed to logs). ' +
          'Use msg91, or set ALLOW_CONSOLE_OTP=true only on staging.'
      );
    }
  }

  const port = parseInt(env.PORT ?? '3001', 10);

  return {
    nodeEnv,
    port,
    databaseUrl: env.DATABASE_URL ?? 'postgres://boutique:boutique@localhost:5433/boutique',
    jwtSecret,
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    seedOnStart,
    googleClientId: env.GOOGLE_CLIENT_ID?.trim() || null,
    paymentProvider,
    smsProvider,
    msg91AuthKey: env.MSG91_AUTH_KEY?.trim() || null,
    msg91TemplateId: env.MSG91_TEMPLATE_ID?.trim() || null,
    otpDevCode: env.OTP_DEV_CODE?.trim() || null,
    // No fail-closed guard needed: a missing key just masks the parser (503),
    // uploads themselves keep working.
    anthropicApiKey: env.ANTHROPIC_API_KEY?.trim() || null,
    // ANTHROPIC_MODEL is deliberately NOT read. The deployed launch template
    // still exports ANTHROPIC_MODEL=claude-sonnet-5 (main.yaml's AnthropicModel
    // parameter, now vestigial), and honouring it as a global override would
    // silently read handwritten bills with Sonnet instead of the Opus 5 that
    // PARSE_SPECS picks for them. Models live in src/services/ai/prompts.ts,
    // which is the file prompt tuning edits anyway. index.ts warns if it is set.
    s3UploadsBucket: env.S3_UPLOADS_BUCKET?.trim() || null,
    uploadsDir: env.UPLOADS_DIR?.trim() || `${process.cwd()}/.data/uploads`,
    publicApiUrl: env.PUBLIC_API_URL?.trim() || `http://localhost:${port}`,
  };
}
