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
  /** AWS region whose Bedrock endpoint serves the parse calls. */
  bedrockRegion: string;
  /** Null means no S3 — the dev LocalObjectStore serves uploads instead. */
  s3UploadsBucket: string | null;
  /** LocalObjectStore directory (dev only; ignored when S3 is configured). */
  uploadsDir: string;
  /** Public base URL of this API — the LocalObjectStore presigns against it. */
  publicApiUrl: string;
}

const DEV_JWT_SECRET = 'dev-secret-change-in-prod';

/**
 * Region whose Bedrock endpoint serves document parsing — not ap-south-1, where
 * the rest of this stack runs. Probed 2026-07-30 from account 741868637305:
 * every Anthropic model id returns `not_found_error` on ap-south-1's endpoint
 * while us-east-1 returns `permission_error` for the same ids, i.e. they resolve
 * there and only account-level model access is missing. Mumbai is documented as
 * global-routing-only for these models, so requests leave India either way and
 * pinning the call region gives up no data residency we had.
 *
 * Set BEDROCK_REGION to retest ap-south-1 once model access is granted.
 */
const DEFAULT_BEDROCK_REGION = 'us-east-1';

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
    // Parsing needs no credential of its own — Bedrock is reached with the
    // instance role. When IAM or model access is missing the parse endpoint
    // answers 503 and the wizard falls back to manual entry; uploads keep working.
    bedrockRegion: env.BEDROCK_REGION?.trim() || DEFAULT_BEDROCK_REGION,
    // ANTHROPIC_MODEL is deliberately NOT read. The deployed launch template still
    // exports ANTHROPIC_MODEL=claude-sonnet-5 from when parsing used an API key,
    // and honouring it as a global override would silently read handwritten bills
    // with Sonnet instead of the Opus that PARSE_SPECS picks for them. Models live
    // in src/services/ai/prompts.ts, which is edited during prompt tuning anyway.
    s3UploadsBucket: env.S3_UPLOADS_BUCKET?.trim() || null,
    uploadsDir: env.UPLOADS_DIR?.trim() || `${process.cwd()}/.data/uploads`,
    publicApiUrl: env.PUBLIC_API_URL?.trim() || `http://localhost:${port}`,
  };
}
