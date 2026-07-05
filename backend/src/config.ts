export interface Config {
  port: number;
  databaseUrl: string;
  jwtSecret: string;
  corsOrigins: string[];
  seedOnStart: boolean;
  /** Null keeps Google sign-in masked (endpoint answers 503). */
  googleClientId: string | null;
}

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  return {
    port: parseInt(env.PORT ?? '3001', 10),
    databaseUrl: env.DATABASE_URL ?? 'postgres://boutique:boutique@localhost:5433/boutique',
    jwtSecret: env.JWT_SECRET ?? 'dev-secret-change-in-prod',
    corsOrigins: (env.CORS_ORIGINS ?? 'http://localhost:5173,http://localhost:5174')
      .split(',')
      .map((s) => s.trim())
      .filter(Boolean),
    seedOnStart: env.SEED_ON_START === 'true',
    googleClientId: env.GOOGLE_CLIENT_ID?.trim() || null,
  };
}
