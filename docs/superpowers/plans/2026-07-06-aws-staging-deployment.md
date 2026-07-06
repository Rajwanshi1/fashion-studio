# AWS Staging Deployment Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deploy the boutique platform to a production-grade AWS staging environment (CloudFormation, segregated app/data EC2 layers, hard data-deletion protection), then prove it with live E2E tests and a security audit.

**Architecture:** Six CloudFormation stacks — `backup-replica` (ap-southeast-1), `network`, `data`, `app` (ap-south-1), `waf` (us-east-1), `edge` (ap-south-1/global). Three SPAs on S3+CloudFront, API on an ASG behind an internal ALB reached via a CloudFront VPC origin, Postgres 16 in Docker on a protected data EC2 with a separate encrypted EBS volume, DLM snapshots, and pg_dump→S3 with cross-region replication. Spec: `docs/superpowers/specs/2026-07-06-aws-staging-deployment-design.md`.

**Tech Stack:** CloudFormation YAML, AWS CLI v2, Docker, Hono 4 / Node 22, Playwright.

## Global Constraints

- AWS account `741868637305`, IAM user `desktop-access` (AdministratorAccess). Regions: primary `ap-south-1`, backup replica `ap-southeast-1`, WAF `us-east-1`.
- Stack names: `fashion-<env>-<piece>`; env is `staging` now (`prod` params written, never deployed by this plan).
- Cross-stack export names: `fashion-<env>-vpc`, `-public-subnet-a/-b`, `-private-subnet-a/-b`, `-alb-sg`, `-app-sg`, `-data-sg`, `-data-private-ip`, `-db-secret-arn`, `-backup-bucket`, `-alb-arn`, `-alb-dns`, `-ecr-uri`, `-jwt-secret-arn`, `-seed-admin-secret-arn`, `-seed-customer-secret-arn`, `-asg-name`, `-api-log-group`.
- Secrets Manager names: `fashion/<env>/db-password`, `fashion/<env>/jwt-secret`, `fashion/<env>/seed-admin-password`, `fashion/<env>/seed-customer-password`. SSM params: `/fashion/<env>/cors-origins`, `/fashion/<env>/api-image-tag`. Log group `/fashion/<env>/api`. ECR repo `fashion-studio-api`.
- VPC `10.20.0.0/16`: public `10.20.0.0/24` (AZ a), `10.20.1.0/24` (AZ b); private `10.20.10.0/24` (a), `10.20.11.0/24` (b).
- Every taggable resource: `Project=fashion-studio`, `Env=<env>` tags.
- Data-layer resources (data EC2, data EBS volume, KMS key, backup buckets): `DeletionPolicy: Retain` + `UpdateReplacePolicy: Retain`. Data EC2 also `DisableApiTermination: true`. ALL stacks get termination protection enabled by the deploy script.
- All EC2: IMDSv2 required (`MetadataOptions: HttpTokens: required`), no public IPs, no SSH keys (SSM Session Manager only), AL2023 AMI via SSM parameter type default `/aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64`, gp3 encrypted volumes.
- App code scope is FIXED (deploy-critical only, per approved spec §5): cherry-pick `4dd6594`, rate limiting, secureHeaders+bodyLimit, `/api/ready`, migration advisory lock, seed password env overrides + standalone seed runner, `VITE_API_URL` build-time fail-loud, e2e URL parameterization. NOTHING ELSE — no Razorpay work, no JWT refresh, no CI, no db.ts pool tuning.
- Commits: one per task, on `main`, message style `feat(infra): ...` / `feat(backend): ...`, trailer `Co-Authored-By: Claude Fable 5 <noreply@anthropic.com>`. Subagents do NOT push.
- Local dev must keep working untouched: every new env var has a localhost-compatible default.

---

## Phase A — App hardening (deploy-critical only)

### Task 1: Cherry-pick the parked boot-hardening commit

**Files:**
- Modify (via cherry-pick): `backend/src/config.ts`, `backend/test/config.test.ts`, `docker-compose.yml`

**Interfaces:**
- Produces: `loadConfig()` that throws in `NODE_ENV=production` when JWT_SECRET is unset/default/short or `SEED_ON_START=true`. Later tasks rely on staging running `NODE_ENV=production` + `SEED_ON_START=false` + a ≥32-char generated JWT secret.

- [ ] **Step 1: Cherry-pick**

```bash
git cherry-pick 4dd6594
```
Expected: clean apply (3 files). If a conflict appears in `docker-compose.yml` or `config.ts`, keep BOTH sides (main's `googleClientId` lines and the commit's validation block), then `git cherry-pick --continue`.

- [ ] **Step 2: Run backend tests**

Run: `cd backend && npm test`
Expected: all suites PASS (≈90 pre-existing + new config tests). If `config.test.ts` fails because `loadConfig`'s shape drifted on main, fix the test expectations to match main's `Config` interface (which now includes `googleClientId`), not by weakening the validation.

- [ ] **Step 3: Verify commit landed**

Run: `git log --oneline -1`
Expected: `feat(backend): validate JWT secret + block seeding in production boot` (cherry-pick keeps the original message; no extra commit needed).

### Task 2: Per-IP rate limiting middleware

**Files:**
- Create: `backend/src/middleware/rate-limit.ts`
- Create: `backend/test/rate-limit.test.ts`
- Modify: `backend/src/app.ts` (mount after CORS at line ~76, before routes)

**Interfaces:**
- Produces: `rateLimit({ windowMs, max, now? })` Hono middleware factory. Mounted: `/api/auth/*` 30 req/min/IP; `/api/*` 300 req/min/IP. 429 body `{ error: 'Too many requests' }`.

- [ ] **Step 1: Write the failing test**

`backend/test/rate-limit.test.ts`:
```ts
import { Hono } from 'hono';
import { describe, expect, it } from 'vitest';
import { rateLimit } from '../src/middleware/rate-limit';

function appWithLimit(max: number, now: () => number) {
  const app = new Hono();
  app.use('/x/*', rateLimit({ windowMs: 60_000, max, now }));
  app.get('/x/ping', (c) => c.json({ ok: true }));
  return app;
}

const from = (ip: string) => ({ headers: { 'x-forwarded-for': `${ip}, 10.20.0.5` } });

describe('rateLimit', () => {
  it('allows up to max requests then returns 429', async () => {
    const app = appWithLimit(3, () => 1_000);
    for (let i = 0; i < 3; i++) {
      expect((await app.request('/x/ping', from('1.2.3.4'))).status).toBe(200);
    }
    const blocked = await app.request('/x/ping', from('1.2.3.4'));
    expect(blocked.status).toBe(429);
    expect(await blocked.json()).toEqual({ error: 'Too many requests' });
  });

  it('tracks IPs independently (first X-Forwarded-For hop)', async () => {
    const app = appWithLimit(1, () => 1_000);
    expect((await app.request('/x/ping', from('1.1.1.1'))).status).toBe(200);
    expect((await app.request('/x/ping', from('2.2.2.2'))).status).toBe(200);
    expect((await app.request('/x/ping', from('1.1.1.1'))).status).toBe(429);
  });

  it('resets after the window elapses', async () => {
    let t = 1_000;
    const app = appWithLimit(1, () => t);
    expect((await app.request('/x/ping', from('9.9.9.9'))).status).toBe(200);
    expect((await app.request('/x/ping', from('9.9.9.9'))).status).toBe(429);
    t += 61_000;
    expect((await app.request('/x/ping', from('9.9.9.9'))).status).toBe(200);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/rate-limit.test.ts`
Expected: FAIL — cannot resolve `../src/middleware/rate-limit`.

- [ ] **Step 3: Implement**

`backend/src/middleware/rate-limit.ts`:
```ts
import { createMiddleware } from 'hono/factory';

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Injectable clock for tests. */
  now?: () => number;
}

interface Bucket {
  count: number;
  resetAt: number;
}

/**
 * Fixed-window in-memory limiter keyed by client IP (first X-Forwarded-For
 * hop — the ALB appends the true client). Per-instance state: each ASG
 * instance enforces its own window; fleet-wide limiting is WAF's job.
 */
export function rateLimit({ windowMs, max, now = Date.now }: RateLimitOptions) {
  const buckets = new Map<string, Bucket>();
  return createMiddleware(async (c, next) => {
    const t = now();
    const ip = c.req.header('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown';
    const bucket = buckets.get(ip);
    if (!bucket || bucket.resetAt <= t) {
      if (buckets.size > 10_000) buckets.clear(); // bound memory; resets windows, acceptable
      buckets.set(ip, { count: 1, resetAt: t + windowMs });
    } else if (++bucket.count > max) {
      return c.json({ error: 'Too many requests' }, 429);
    }
    await next();
  });
}
```

In `backend/src/app.ts`, after the CORS mount (`app.use('/api/*', cors(...))`) and before `app.get('/api/health', ...)`:
```ts
app.use('/api/auth/*', rateLimit({ windowMs: 60_000, max: 30 }));
app.use('/api/*', rateLimit({ windowMs: 60_000, max: 300 }));
```
with `import { rateLimit } from './middleware/rate-limit';` at the top.

- [ ] **Step 4: Run tests**

Run: `cd backend && npm test`
Expected: new suite PASS, all existing suites still PASS (existing API tests make far fewer than 300 requests per suite from one fake IP; if any suite trips 429, raise the global mount to `max: 1000` and note it in the commit message — do NOT delete the mount).

- [ ] **Step 5: Commit**

```bash
git add backend/src/middleware/rate-limit.ts backend/test/rate-limit.test.ts backend/src/app.ts
git commit -m "feat(backend): per-IP rate limiting (strict on auth routes)"
```

### Task 3: secureHeaders, bodyLimit, /api/ready, migration advisory lock

**Files:**
- Modify: `backend/src/app.ts` (imports, `AppDeps`, middleware mounts, ready route)
- Modify: `backend/src/index.ts:30-44` (wire `pingDb`)
- Modify: `backend/src/migrate.ts` (advisory lock)
- Create: `backend/test/ready.test.ts`

**Interfaces:**
- Consumes: nothing new.
- Produces: `AppDeps.pingDb?: () => Promise<void>`; `GET /api/ready` → 200 `{ status: 'ready' }` | 503 `{ status: 'unavailable' }` (ALB health-check target); `migrate()` serialized via `pg_advisory_lock(727272)`.

- [ ] **Step 1: Write the failing test**

`backend/test/ready.test.ts` — follow the construction pattern used at the top of the existing `backend/test` API suites (they build `createApp` with stub repos; reuse their fixture helper if one is exported, otherwise copy the minimal deps object from an existing suite):
```ts
import { describe, expect, it } from 'vitest';
// Reuse the same makeApp/fixture helper the existing API tests use, adding pingDb:
import { makeTestApp } from './helpers'; // ← adjust to the repo's actual fixture; if none is
// exported, inline the same stub-deps object the other suites construct.

describe('GET /api/ready', () => {
  it('returns 200 ready when the DB ping succeeds', async () => {
    const app = makeTestApp({ pingDb: async () => {} });
    const res = await app.request('/api/ready');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ status: 'ready' });
  });

  it('returns 503 when the DB ping fails', async () => {
    const app = makeTestApp({ pingDb: async () => { throw new Error('down'); } });
    const res = await app.request('/api/ready');
    expect(res.status).toBe(503);
    expect(await res.json()).toEqual({ status: 'unavailable' });
  });

  it('returns 503 when pingDb is not wired', async () => {
    const app = makeTestApp({});
    const res = await app.request('/api/ready');
    expect(res.status).toBe(503);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `cd backend && npx vitest run test/ready.test.ts`
Expected: FAIL — 404 (route absent).

- [ ] **Step 3: Implement app.ts changes**

In `backend/src/app.ts`:
```ts
import { bodyLimit } from 'hono/body-limit';
import { secureHeaders } from 'hono/secure-headers';
```
Add to `AppDeps`:
```ts
  /** Liveness probe against the DB pool; absent → /api/ready always 503. */
  pingDb?: () => Promise<void>;
```
After `const app = new Hono<AuthEnv>();` add:
```ts
  app.use(secureHeaders());
  app.use(
    '/api/*',
    bodyLimit({
      maxSize: 100 * 1024,
      onError: (c) => c.json({ error: 'Payload too large' }, 413),
    }),
  );
```
After the `/api/health` route add:
```ts
  app.get('/api/ready', async (c) => {
    if (!deps.pingDb) return c.json({ status: 'unavailable' }, 503);
    try {
      await Promise.race([
        deps.pingDb(),
        new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 2_000)),
      ]);
      return c.json({ status: 'ready' });
    } catch {
      return c.json({ status: 'unavailable' }, 503);
    }
  });
```
In `backend/src/index.ts` `createApp({...})` deps add:
```ts
    pingDb: async () => {
      await pool.query('SELECT 1');
    },
```

- [ ] **Step 4: Implement the advisory lock in migrate.ts**

Wrap the existing body of `migrate()` (everything after the `CREATE TABLE IF NOT EXISTS schema_migrations` statement stays identical, just indented inside the try):
```ts
export async function migrate(pool: Pool, migrationsDir: string): Promise<string[]> {
  // Serialize concurrent boots (ASG replicas race to apply migrations).
  const lock = await pool.connect();
  await lock.query('SELECT pg_advisory_lock(727272)');
  try {
    await pool.query(
      `CREATE TABLE IF NOT EXISTS schema_migrations (
         name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now()
       )`,
    );
    // ... existing loop unchanged ...
    return applied;
  } finally {
    await lock.query('SELECT pg_advisory_unlock(727272)');
    lock.release();
  }
}
```

- [ ] **Step 5: Run full backend suite**

Run: `cd backend && npm test`
Expected: ALL PASS (ready suite green; existing suites unaffected — `pingDb` is optional; secureHeaders/bodyLimit change no JSON bodies. If a test asserts on exact response headers, update it to tolerate the new security headers).

- [ ] **Step 6: Commit**

```bash
git add backend/src/app.ts backend/src/index.ts backend/src/migrate.ts backend/test/ready.test.ts
git commit -m "feat(backend): secure headers, body limit, /api/ready probe, migration advisory lock"
```

### Task 4: Seed password env overrides + standalone seed runner

**Files:**
- Modify: `backend/src/seed.ts` (USERS list → built inside `seed()` from overrides, lines ~239-257)
- Modify: `backend/src/index.ts:25-28` (pass overrides)
- Create: `backend/src/seed-cli.ts`

**Interfaces:**
- Consumes: `seed(pool)` from Task 0 state; `migrate` from Task 3.
- Produces: `seed(pool, overrides?: { adminPassword?: string; customerPassword?: string })`; runnable `node dist/seed-cli.js` (env: `DATABASE_URL` required; `SEED_ADMIN_PASSWORD`, `SEED_CUSTOMER_PASSWORD`, `MIGRATIONS_DIR` optional). Task 13 runs this via SSM inside the API image.

- [ ] **Step 1: Change seed() signature**

In `backend/src/seed.ts`, delete the module-level `const USERS = [...]` and build it inside `seed()`:
```ts
export interface SeedOverrides {
  adminPassword?: string;
  customerPassword?: string;
}

/** Idempotent seed: catalog is skipped when any product exists; users are upsert-checked. */
export async function seed(pool: Pool, overrides: SeedOverrides = {}): Promise<boolean> {
  const USERS = [
    {
      email: 'admin@tanviagnihotry.com',
      password: overrides.adminPassword ?? 'TanviAdmin@2026',
      firstName: 'Tanvi',
      lastName: 'Agnihotry',
      role: 'admin' as const,
    },
    {
      email: 'aanya@example.com',
      password: overrides.customerPassword ?? 'Aanya@2026',
      firstName: 'Aanya',
      lastName: 'Mehra',
      role: 'customer' as const,
    },
  ];
  // ... rest of the existing function body unchanged ...
```
In `backend/src/index.ts` change the seed call:
```ts
  if (config.seedOnStart) {
    const seeded = await seed(pool, {
      adminPassword: process.env.SEED_ADMIN_PASSWORD,
      customerPassword: process.env.SEED_CUSTOMER_PASSWORD,
    });
    console.log(seeded ? 'Seeded catalog + users' : 'Seed skipped (products already exist)');
  }
```

- [ ] **Step 2: Create the standalone runner**

`backend/src/seed-cli.ts` (reads env directly — deliberately does NOT call `loadConfig()`, so the production boot-guard doesn't apply to this explicit operator action):
```ts
import path from 'path';
import { createPool } from './db';
import { migrate } from './migrate';
import { seed } from './seed';

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error('DATABASE_URL is required');
  const pool = createPool(url);
  const dir = process.env.MIGRATIONS_DIR ?? path.join(process.cwd(), 'db', 'migrations');
  const applied = await migrate(pool, dir);
  if (applied.length) console.log(`Applied migrations: ${applied.join(', ')}`);
  const seeded = await seed(pool, {
    adminPassword: process.env.SEED_ADMIN_PASSWORD,
    customerPassword: process.env.SEED_CUSTOMER_PASSWORD,
  });
  console.log(seeded ? 'Seeded catalog + users' : 'Seed skipped (products already exist)');
  await pool.end();
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exit(1);
});
```

- [ ] **Step 3: Verify build + tests**

Run: `cd backend && npm run build && npm test`
Expected: build emits `dist/seed-cli.js`; all tests PASS. If `backend/test` contains a DB-backed seed test, extend it to assert an override password verifies with `bcrypt.compare`; if no DB harness exists, coverage for the override comes from Task 14 (E2E logs in with the staging admin password).

- [ ] **Step 4: Commit**

```bash
git add backend/src/seed.ts backend/src/index.ts backend/src/seed-cli.ts
git commit -m "feat(backend): seed password env overrides + standalone seed-cli runner"
```

### Task 5: SPA build-time VITE_API_URL guard + e2e URL parameterization

**Files:**
- Modify: `frontend/vite.config.ts`, `admin/vite.config.ts`, `socials/vite.config.ts`
- Modify: `e2e/tests/helpers.ts:3-6`, `e2e/playwright.config.ts:15`
- Check (no change expected): `scripts/verify-api.sh` already honors `API` env (line 5)

**Interfaces:**
- Produces: production builds FAIL without `VITE_API_URL` (tracker #8). E2E envs consumed by Task 14: `E2E_BASE_URL`, `E2E_ADMIN_URL`, `E2E_API_URL`, `E2E_ADMIN_EMAIL`, `E2E_ADMIN_PASSWORD` (all defaulting to today's localhost/seed values, so local runs are unchanged).

- [ ] **Step 1: Add the build guard to each vite config**

In each of `frontend/vite.config.ts`, `admin/vite.config.ts`, `socials/vite.config.ts`, convert the config to the function form and add the guard (adapt around whatever plugins each already has — do not drop them):
```ts
import { defineConfig, loadEnv } from 'vite';

export default defineConfig(({ mode }) => {
  if (mode === 'production' && !(process.env.VITE_API_URL ?? loadEnv(mode, process.cwd(), '').VITE_API_URL)) {
    throw new Error('VITE_API_URL must be set for production builds (see PRODUCTION-TODO #8)');
  }
  return {
    /* existing config object unchanged */
  };
});
```

- [ ] **Step 2: Verify the guard fires and passes**

```bash
cd frontend && npm run build            # Expected: FAILS with the VITE_API_URL error
VITE_API_URL=http://localhost:3001 npm run build   # Expected: build succeeds
```
Repeat for `admin/` and `socials/`. Then run unit suites: `cd frontend && npm test`, same for `admin`, `socials`. Expected: all PASS (vitest runs in `test` mode — the guard only fires for `production`).

- [ ] **Step 3: Parameterize e2e**

`e2e/tests/helpers.ts` lines 3-6 become:
```ts
export const API = process.env.E2E_API_URL ?? 'http://localhost:3001';
export const ADMIN_URL = process.env.E2E_ADMIN_URL ?? 'http://localhost:4174';
export const ADMIN_EMAIL = process.env.E2E_ADMIN_EMAIL ?? 'admin@tanviagnihotry.com';
export const ADMIN_PASSWORD = process.env.E2E_ADMIN_PASSWORD ?? 'TanviAdmin@2026';
```
`e2e/playwright.config.ts` line 15:
```ts
    baseURL: process.env.E2E_BASE_URL ?? 'http://localhost:4173',
```
Then `grep -rn "Aanya@2026\|aanya@example.com\|localhost:41\|localhost:3001" e2e/tests/` — if any spec hardcodes the demo customer creds or URLs outside helpers.ts, lift them into helpers consts with the same `process.env.E2E_*` pattern (`E2E_CUSTOMER_EMAIL`, `E2E_CUSTOMER_PASSWORD`).

- [ ] **Step 4: Typecheck e2e**

Run: `cd e2e && npx tsc --noEmit`
Expected: clean. (Full e2e re-run happens against staging in Task 14; local stack isn't running here.)

- [ ] **Step 5: Commit**

```bash
git add frontend/vite.config.ts admin/vite.config.ts socials/vite.config.ts e2e/tests/helpers.ts e2e/playwright.config.ts
git commit -m "feat(deploy): VITE_API_URL fail-loud builds + env-parameterized e2e targets"
```

---

## Phase B — Infrastructure (author, validate, deploy one stack per task)

Every template task follows the same cycle: write YAML → `aws cloudformation validate-template` → deploy via CLI → verify with read-only probes → commit. `--capabilities CAPABILITY_NAMED_IAM` on every deploy. After each successful create, enable termination protection (the deploy script in Task 12 automates this; do it manually in these tasks):
```bash
aws cloudformation update-termination-protection --enable-termination-protection --stack-name <name> --region <region>
```

### Task 6: infra scaffolding + backup-replica stack (ap-southeast-1)

**Files:**
- Create: `infra/templates/backup-replica.yaml`

**Interfaces:**
- Produces: stack `fashion-staging-backup-replica` in ap-southeast-1; output `ReplicaBucketArn` consumed by Task 8 as a parameter.

- [ ] **Step 1: Write the template**

`infra/templates/backup-replica.yaml`:
```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: fashion - cross-region replica bucket for DB dumps (deploy in the replica region)
Parameters:
  EnvName:
    Type: String
    AllowedValues: [staging, prod]
Resources:
  ReplicaBucket:
    Type: AWS::S3::Bucket
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      BucketName: !Sub 'fashion-${EnvName}-db-backup-replica-${AWS::AccountId}'
      VersioningConfiguration:
        Status: Enabled
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault:
              SSEAlgorithm: AES256
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
      LifecycleConfiguration:
        Rules:
          - Id: expire-old-replicas
            Status: Enabled
            ExpirationInDays: 90
            NoncurrentVersionExpiration:
              NoncurrentDays: 30
      Tags:
        - { Key: Project, Value: fashion-studio }
        - { Key: Env, Value: !Ref EnvName }
Outputs:
  ReplicaBucketArn:
    Value: !GetAtt ReplicaBucket.Arn
```

- [ ] **Step 2: Validate + deploy**

```bash
aws cloudformation validate-template --template-body file://infra/templates/backup-replica.yaml --region ap-southeast-1
aws cloudformation deploy --region ap-southeast-1 --stack-name fashion-staging-backup-replica \
  --template-file infra/templates/backup-replica.yaml --parameter-overrides EnvName=staging \
  --no-fail-on-empty-changeset
aws cloudformation update-termination-protection --enable-termination-protection \
  --stack-name fashion-staging-backup-replica --region ap-southeast-1
```
Expected: `CREATE_COMPLETE`.

- [ ] **Step 3: Verify + commit**

```bash
aws s3api get-public-access-block --bucket fashion-staging-db-backup-replica-741868637305
# Expected: all four true
git add infra/templates/backup-replica.yaml
git commit -m "feat(infra): backup-replica stack (cross-region dump bucket)"
```

### Task 7: network stack

**Files:**
- Create: `infra/templates/network.yaml`

**Interfaces:**
- Produces: exports `fashion-staging-vpc`, `-public-subnet-a/-b`, `-private-subnet-a/-b`, `-alb-sg`, `-app-sg`, `-data-sg` consumed by Tasks 8, 9, 11.

- [ ] **Step 1: Write the template**

`infra/templates/network.yaml`:
```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: fashion - VPC, subnets, NAT, endpoints, security groups
Parameters:
  EnvName:
    Type: String
    AllowedValues: [staging, prod]
Resources:
  Vpc:
    Type: AWS::EC2::VPC
    Properties:
      CidrBlock: 10.20.0.0/16
      EnableDnsSupport: true
      EnableDnsHostnames: true
      Tags: [{ Key: Name, Value: !Sub 'fashion-${EnvName}' }, { Key: Project, Value: fashion-studio }, { Key: Env, Value: !Ref EnvName }]
  Igw:
    Type: AWS::EC2::InternetGateway
  IgwAttach:
    Type: AWS::EC2::VPCGatewayAttachment
    Properties: { VpcId: !Ref Vpc, InternetGatewayId: !Ref Igw }
  PublicSubnetA:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref Vpc
      CidrBlock: 10.20.0.0/24
      AvailabilityZone: !Select [0, !GetAZs '']
      Tags: [{ Key: Name, Value: !Sub 'fashion-${EnvName}-public-a' }]
  PublicSubnetB:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref Vpc
      CidrBlock: 10.20.1.0/24
      AvailabilityZone: !Select [1, !GetAZs '']
      Tags: [{ Key: Name, Value: !Sub 'fashion-${EnvName}-public-b' }]
  PrivateSubnetA:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref Vpc
      CidrBlock: 10.20.10.0/24
      AvailabilityZone: !Select [0, !GetAZs '']
      Tags: [{ Key: Name, Value: !Sub 'fashion-${EnvName}-private-a' }]
  PrivateSubnetB:
    Type: AWS::EC2::Subnet
    Properties:
      VpcId: !Ref Vpc
      CidrBlock: 10.20.11.0/24
      AvailabilityZone: !Select [1, !GetAZs '']
      Tags: [{ Key: Name, Value: !Sub 'fashion-${EnvName}-private-b' }]
  PublicRt:
    Type: AWS::EC2::RouteTable
    Properties: { VpcId: !Ref Vpc }
  PublicDefaultRoute:
    Type: AWS::EC2::Route
    DependsOn: IgwAttach
    Properties: { RouteTableId: !Ref PublicRt, DestinationCidrBlock: 0.0.0.0/0, GatewayId: !Ref Igw }
  PublicRtA:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties: { SubnetId: !Ref PublicSubnetA, RouteTableId: !Ref PublicRt }
  PublicRtB:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties: { SubnetId: !Ref PublicSubnetB, RouteTableId: !Ref PublicRt }
  NatEip:
    Type: AWS::EC2::EIP
    Properties: { Domain: vpc }
  Nat:
    Type: AWS::EC2::NatGateway
    Properties:
      AllocationId: !GetAtt NatEip.AllocationId
      SubnetId: !Ref PublicSubnetA
  PrivateRt:
    Type: AWS::EC2::RouteTable
    Properties: { VpcId: !Ref Vpc }
  PrivateDefaultRoute:
    Type: AWS::EC2::Route
    Properties: { RouteTableId: !Ref PrivateRt, DestinationCidrBlock: 0.0.0.0/0, NatGatewayId: !Ref Nat }
  PrivateRtA:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties: { SubnetId: !Ref PrivateSubnetA, RouteTableId: !Ref PrivateRt }
  PrivateRtB:
    Type: AWS::EC2::SubnetRouteTableAssociation
    Properties: { SubnetId: !Ref PrivateSubnetB, RouteTableId: !Ref PrivateRt }
  S3Endpoint:
    Type: AWS::EC2::VPCEndpoint
    Properties:
      VpcId: !Ref Vpc
      ServiceName: !Sub 'com.amazonaws.${AWS::Region}.s3'
      VpcEndpointType: Gateway
      RouteTableIds: [!Ref PrivateRt, !Ref PublicRt]
  AlbSg:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: internal ALB - reachable from inside the VPC only (CloudFront VPC-origin ENIs)
      VpcId: !Ref Vpc
      SecurityGroupIngress:
        - { IpProtocol: tcp, FromPort: 80, ToPort: 80, CidrIp: 10.20.0.0/16 }
      Tags: [{ Key: Name, Value: !Sub 'fashion-${EnvName}-alb' }]
  AppSg:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: app instances - API traffic from ALB only
      VpcId: !Ref Vpc
      Tags: [{ Key: Name, Value: !Sub 'fashion-${EnvName}-app' }]
  DataSg:
    Type: AWS::EC2::SecurityGroup
    Properties:
      GroupDescription: data instance - Postgres from app SG only
      VpcId: !Ref Vpc
      Tags: [{ Key: Name, Value: !Sub 'fashion-${EnvName}-data' }]
  AlbToAppEgress:
    Type: AWS::EC2::SecurityGroupEgress
    Properties: { GroupId: !Ref AlbSg, IpProtocol: tcp, FromPort: 3001, ToPort: 3001, DestinationSecurityGroupId: !Ref AppSg }
  AppFromAlbIngress:
    Type: AWS::EC2::SecurityGroupIngress
    Properties: { GroupId: !Ref AppSg, IpProtocol: tcp, FromPort: 3001, ToPort: 3001, SourceSecurityGroupId: !Ref AlbSg }
  AppHttpsEgress:
    Type: AWS::EC2::SecurityGroupEgress
    Properties: { GroupId: !Ref AppSg, IpProtocol: tcp, FromPort: 443, ToPort: 443, CidrIp: 0.0.0.0/0 }
  AppToDataEgress:
    Type: AWS::EC2::SecurityGroupEgress
    Properties: { GroupId: !Ref AppSg, IpProtocol: tcp, FromPort: 5432, ToPort: 5432, DestinationSecurityGroupId: !Ref DataSg }
  AppDnsUdpEgress:
    Type: AWS::EC2::SecurityGroupEgress
    Properties: { GroupId: !Ref AppSg, IpProtocol: udp, FromPort: 53, ToPort: 53, CidrIp: 10.20.0.0/16 }
  AppDnsTcpEgress:
    Type: AWS::EC2::SecurityGroupEgress
    Properties: { GroupId: !Ref AppSg, IpProtocol: tcp, FromPort: 53, ToPort: 53, CidrIp: 10.20.0.0/16 }
  AppNtpEgress:
    Type: AWS::EC2::SecurityGroupEgress
    Properties: { GroupId: !Ref AppSg, IpProtocol: udp, FromPort: 123, ToPort: 123, CidrIp: 169.254.169.123/32 }
  DataFromAppIngress:
    Type: AWS::EC2::SecurityGroupIngress
    Properties: { GroupId: !Ref DataSg, IpProtocol: tcp, FromPort: 5432, ToPort: 5432, SourceSecurityGroupId: !Ref AppSg }
  DataHttpsEgress:
    Type: AWS::EC2::SecurityGroupEgress
    Properties: { GroupId: !Ref DataSg, IpProtocol: tcp, FromPort: 443, ToPort: 443, CidrIp: 0.0.0.0/0 }
  DataDnsUdpEgress:
    Type: AWS::EC2::SecurityGroupEgress
    Properties: { GroupId: !Ref DataSg, IpProtocol: udp, FromPort: 53, ToPort: 53, CidrIp: 10.20.0.0/16 }
  DataDnsTcpEgress:
    Type: AWS::EC2::SecurityGroupEgress
    Properties: { GroupId: !Ref DataSg, IpProtocol: tcp, FromPort: 53, ToPort: 53, CidrIp: 10.20.0.0/16 }
  DataNtpEgress:
    Type: AWS::EC2::SecurityGroupEgress
    Properties: { GroupId: !Ref DataSg, IpProtocol: udp, FromPort: 123, ToPort: 123, CidrIp: 169.254.169.123/32 }
Outputs:
  VpcId:
    Value: !Ref Vpc
    Export: { Name: !Sub 'fashion-${EnvName}-vpc' }
  PublicSubnetA:
    Value: !Ref PublicSubnetA
    Export: { Name: !Sub 'fashion-${EnvName}-public-subnet-a' }
  PublicSubnetB:
    Value: !Ref PublicSubnetB
    Export: { Name: !Sub 'fashion-${EnvName}-public-subnet-b' }
  PrivateSubnetA:
    Value: !Ref PrivateSubnetA
    Export: { Name: !Sub 'fashion-${EnvName}-private-subnet-a' }
  PrivateSubnetB:
    Value: !Ref PrivateSubnetB
    Export: { Name: !Sub 'fashion-${EnvName}-private-subnet-b' }
  AlbSg:
    Value: !Ref AlbSg
    Export: { Name: !Sub 'fashion-${EnvName}-alb-sg' }
  AppSg:
    Value: !Ref AppSg
    Export: { Name: !Sub 'fashion-${EnvName}-app-sg' }
  DataSg:
    Value: !Ref DataSg
    Export: { Name: !Sub 'fashion-${EnvName}-data-sg' }
```
Note the default SG egress: when a SG declares NO SecurityGroupEgress inline, AWS adds allow-all egress. Because we attach explicit Egress rule resources, CloudFormation does NOT remove the default allow-all rule automatically for rules added via separate resources. After deploy, remove the default egress rule from AppSg/DataSg/AlbSg:
```bash
for SG in $(aws ec2 describe-security-groups --filters Name=tag:Name,Values=fashion-staging-alb,fashion-staging-app,fashion-staging-data --query 'SecurityGroups[].GroupId' --output text --region ap-south-1); do
  aws ec2 revoke-security-group-egress --group-id $SG --ip-permissions '[{"IpProtocol":"-1","IpRanges":[{"CidrIp":"0.0.0.0/0"}]}]' --region ap-south-1 || true
done
```
(`|| true` because the rule may not exist. The security audit in Task 15 re-checks this.)

- [ ] **Step 2: Validate + deploy + verify + commit**

```bash
aws cloudformation validate-template --template-body file://infra/templates/network.yaml --region ap-south-1
aws cloudformation deploy --region ap-south-1 --stack-name fashion-staging-network \
  --template-file infra/templates/network.yaml --parameter-overrides EnvName=staging --no-fail-on-empty-changeset
aws cloudformation update-termination-protection --enable-termination-protection --stack-name fashion-staging-network --region ap-south-1
# then the revoke-default-egress loop above
aws ec2 describe-nat-gateways --filter Name=vpc-id,Values=$(aws cloudformation list-exports --region ap-south-1 --query "Exports[?Name=='fashion-staging-vpc'].Value" --output text) --region ap-south-1 --query 'NatGateways[].State'
# Expected: ["available"]
git add infra/templates/network.yaml && git commit -m "feat(infra): network stack (VPC, NAT, endpoints, SG chain)"
```

### Task 8: data stack (the protected layer)

**Files:**
- Create: `infra/templates/data.yaml`

**Interfaces:**
- Consumes: network exports; `ReplicaBucketArn` from Task 6 (passed as a parameter by the deploy command).
- Produces: exports `fashion-staging-data-private-ip`, `-db-secret-arn`, `-backup-bucket`. A running Postgres 16 reachable at `<private-ip>:5432` with user/db `boutique` and the generated password.

- [ ] **Step 1: Write the template**

`infra/templates/data.yaml` — CRITICAL: every `${...}` in the UserData that is meant for bash (not CloudFormation) must avoid brace syntax (`$VAR` not `${VAR}`); the CloudWatch-agent config's `${aws:InstanceId}` must be written `${!aws:InstanceId}` inside `!Sub`.
```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: fashion - protected data layer (Postgres EC2 + EBS + backups). NEVER DELETE.
Parameters:
  EnvName:
    Type: String
    AllowedValues: [staging, prod]
  DataInstanceType:
    Type: String
    Default: t3.small
  AmiId:
    Type: AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>
    Default: /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64
  ReplicaBucketArn:
    Type: String
Resources:
  DataKmsKey:
    Type: AWS::KMS::Key
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      Description: !Sub 'fashion-${EnvName} data-layer EBS encryption'
      EnableKeyRotation: true
      KeyPolicy:
        Version: '2012-10-17'
        Statement:
          - Sid: root
            Effect: Allow
            Principal: { AWS: !Sub 'arn:aws:iam::${AWS::AccountId}:root' }
            Action: 'kms:*'
            Resource: '*'
  DataKmsAlias:
    Type: AWS::KMS::Alias
    Properties:
      AliasName: !Sub 'alias/fashion-${EnvName}-data'
      TargetKeyId: !Ref DataKmsKey
  DbPasswordSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      Name: !Sub 'fashion/${EnvName}/db-password'
      GenerateSecretString:
        PasswordLength: 32
        ExcludePunctuation: true
        IncludeSpace: false
  BackupBucket:
    Type: AWS::S3::Bucket
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      BucketName: !Sub 'fashion-${EnvName}-db-backup-${AWS::AccountId}'
      VersioningConfiguration: { Status: Enabled }
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault: { SSEAlgorithm: AES256 }
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
      LifecycleConfiguration:
        Rules:
          - Id: expire-old-dumps
            Status: Enabled
            ExpirationInDays: 30
            NoncurrentVersionExpiration: { NoncurrentDays: 7 }
      ReplicationConfiguration:
        Role: !GetAtt ReplicationRole.Arn
        Rules:
          - Id: to-replica-region
            Status: Enabled
            Priority: 1
            Filter: { Prefix: '' }
            DeleteMarkerReplication: { Status: Disabled }
            Destination: { Bucket: !Ref ReplicaBucketArn }
      Tags:
        - { Key: Project, Value: fashion-studio }
        - { Key: Env, Value: !Ref EnvName }
  ReplicationRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: { Service: s3.amazonaws.com }
            Action: sts:AssumeRole
      Policies:
        - PolicyName: replicate
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: ['s3:GetReplicationConfiguration', 's3:ListBucket']
                Resource: !Sub 'arn:aws:s3:::fashion-${EnvName}-db-backup-${AWS::AccountId}'
              - Effect: Allow
                Action: ['s3:GetObjectVersionForReplication', 's3:GetObjectVersionAcl', 's3:GetObjectVersionTagging']
                Resource: !Sub 'arn:aws:s3:::fashion-${EnvName}-db-backup-${AWS::AccountId}/*'
              - Effect: Allow
                Action: ['s3:ReplicateObject', 's3:ReplicateDelete', 's3:ReplicateTags']
                Resource: !Sub '${ReplicaBucketArn}/*'
  DataRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: { Service: ec2.amazonaws.com }
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
        - arn:aws:iam::aws:policy/CloudWatchAgentServerPolicy
      Policies:
        - PolicyName: data-instance
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: s3:PutObject
                Resource: !Sub 'arn:aws:s3:::fashion-${EnvName}-db-backup-${AWS::AccountId}/*'
              - Effect: Allow
                Action: secretsmanager:GetSecretValue
                Resource: !Ref DbPasswordSecret
  DataInstanceProfile:
    Type: AWS::IAM::InstanceProfile
    Properties:
      Roles: [!Ref DataRole]
  DataVolume:
    Type: AWS::EC2::Volume
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      AvailabilityZone: !Select [0, !GetAZs '']
      Size: 30
      VolumeType: gp3
      Encrypted: true
      KmsKeyId: !Ref DataKmsKey
      Tags:
        - { Key: Name, Value: !Sub 'fashion-${EnvName}-pgdata' }
        - { Key: 'dlm:backup', Value: !Sub 'fashion-${EnvName}-data' }
  DataInstance:
    Type: AWS::EC2::Instance
    DeletionPolicy: Retain
    UpdateReplacePolicy: Retain
    Properties:
      InstanceType: !Ref DataInstanceType
      ImageId: !Ref AmiId
      SubnetId: !ImportValue
        'Fn::Sub': 'fashion-${EnvName}-private-subnet-a'
      SecurityGroupIds:
        - !ImportValue
          'Fn::Sub': 'fashion-${EnvName}-data-sg'
      IamInstanceProfile: !Ref DataInstanceProfile
      DisableApiTermination: true
      Monitoring: true
      MetadataOptions: { HttpTokens: required, HttpEndpoint: enabled }
      BlockDeviceMappings:
        - DeviceName: /dev/xvda
          Ebs: { VolumeSize: 20, VolumeType: gp3, Encrypted: true }
      Tags:
        - { Key: Name, Value: !Sub 'fashion-${EnvName}-data' }
        - { Key: Project, Value: fashion-studio }
        - { Key: Env, Value: !Ref EnvName }
      UserData:
        Fn::Base64: !Sub |
          #!/bin/bash
          set -uo pipefail
          exec > /var/log/user-data.log 2>&1
          dnf -y install docker cronie amazon-cloudwatch-agent
          systemctl enable --now docker crond

          VOLID="${DataVolume}"
          DEV="/dev/disk/by-id/nvme-Amazon_Elastic_Block_Store_$(echo $VOLID | tr -d -)"
          for i in $(seq 1 120); do [ -e "$DEV" ] && break; sleep 5; done
          blkid "$DEV" || mkfs -t xfs "$DEV"
          mkdir -p /data
          grep -q ' /data ' /etc/fstab || echo "$DEV /data xfs defaults,nofail 0 2" >> /etc/fstab
          mount -a
          mkdir -p /data/pgdata

          PW=$(aws secretsmanager get-secret-value --secret-id fashion/${EnvName}/db-password --region ${AWS::Region} --query SecretString --output text)
          docker rm -f pg 2>/dev/null || true
          docker run -d --name pg --restart always \
            -e POSTGRES_USER=boutique -e POSTGRES_DB=boutique -e POSTGRES_PASSWORD="$PW" \
            -v /data/pgdata:/var/lib/postgresql/data \
            -p 5432:5432 postgres:16-alpine

          cat > /usr/local/bin/pg-backup.sh <<'EOS'
          #!/bin/bash
          set -euo pipefail
          STAMP=$(date -u +%Y%m%dT%H%M%SZ)
          docker exec pg pg_dump -U boutique -Fc boutique > /tmp/boutique-$STAMP.dump
          aws s3 cp /tmp/boutique-$STAMP.dump s3://BACKUP_BUCKET/dumps/boutique-$STAMP.dump
          rm -f /tmp/boutique-$STAMP.dump
          EOS
          sed -i "s|BACKUP_BUCKET|${BackupBucket}|" /usr/local/bin/pg-backup.sh
          chmod +x /usr/local/bin/pg-backup.sh
          echo "17 21 * * * root /usr/local/bin/pg-backup.sh >> /var/log/pg-backup.log 2>&1" > /etc/cron.d/pg-backup

          cat > /opt/aws/amazon-cloudwatch-agent/etc/config.json <<'EOC'
          {"metrics":{"namespace":"Fashion/Data","append_dimensions":{"InstanceId":"${!aws:InstanceId}"},"metrics_collected":{"disk":{"resources":["/data"],"measurement":["used_percent"],"drop_device":true,"metrics_collection_interval":60}}}}
          EOC
          /opt/aws/amazon-cloudwatch-agent/bin/amazon-cloudwatch-agent-ctl -a fetch-config -m ec2 -c file:/opt/aws/amazon-cloudwatch-agent/etc/config.json -s
  DataVolumeAttachment:
    Type: AWS::EC2::VolumeAttachment
    Properties:
      InstanceId: !Ref DataInstance
      VolumeId: !Ref DataVolume
      Device: /dev/sdf
  DlmRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: { Service: dlm.amazonaws.com }
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/service-role/AWSDataLifecycleManagerServiceRole
  SnapshotPolicy:
    Type: AWS::DLM::LifecyclePolicy
    Properties:
      Description: !Sub 'fashion-${EnvName} pgdata volume snapshots every 4h'
      State: ENABLED
      ExecutionRoleArn: !GetAtt DlmRole.Arn
      PolicyDetails:
        ResourceTypes: [VOLUME]
        TargetTags:
          - { Key: 'dlm:backup', Value: !Sub 'fashion-${EnvName}-data' }
        Schedules:
          - Name: every-4h
            CreateRule: { Interval: 4, IntervalUnit: HOURS }
            RetainRule: { Count: 42 }
            CopyTags: true
  RecoveryAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmDescription: auto-recover the data instance on system failure
      Namespace: AWS/EC2
      MetricName: StatusCheckFailed_System
      Dimensions: [{ Name: InstanceId, Value: !Ref DataInstance }]
      Statistic: Maximum
      Period: 60
      EvaluationPeriods: 2
      Threshold: 0
      ComparisonOperator: GreaterThanThreshold
      AlarmActions:
        - !Sub 'arn:aws:automate:${AWS::Region}:ec2:recover'
  DataDiskAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmDescription: pgdata volume over 80 percent
      Namespace: Fashion/Data
      MetricName: disk_used_percent
      Dimensions:
        - { Name: InstanceId, Value: !Ref DataInstance }
        - { Name: path, Value: /data }
        - { Name: fstype, Value: xfs }
      Statistic: Average
      Period: 300
      EvaluationPeriods: 1
      Threshold: 80
      ComparisonOperator: GreaterThanOrEqualToThreshold
      TreatMissingData: notBreaching
Outputs:
  DataPrivateIp:
    Value: !GetAtt DataInstance.PrivateIp
    Export: { Name: !Sub 'fashion-${EnvName}-data-private-ip' }
  DbSecretArn:
    Value: !Ref DbPasswordSecret
    Export: { Name: !Sub 'fashion-${EnvName}-db-secret-arn' }
  BackupBucketName:
    Value: !Ref BackupBucket
    Export: { Name: !Sub 'fashion-${EnvName}-backup-bucket' }
```
Note on `!ImportValue` + `!Sub` nesting: the `!ImportValue\n  'Fn::Sub': ...` form above is the required YAML spelling (short-form tags can't nest directly).

- [ ] **Step 2: Validate + deploy**

```bash
aws cloudformation validate-template --template-body file://infra/templates/data.yaml --region ap-south-1
REPLICA_ARN=$(aws cloudformation describe-stacks --region ap-southeast-1 --stack-name fashion-staging-backup-replica --query "Stacks[0].Outputs[?OutputKey=='ReplicaBucketArn'].OutputValue" --output text)
aws cloudformation deploy --region ap-south-1 --stack-name fashion-staging-data \
  --template-file infra/templates/data.yaml --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides EnvName=staging ReplicaBucketArn=$REPLICA_ARN --no-fail-on-empty-changeset
aws cloudformation update-termination-protection --enable-termination-protection --stack-name fashion-staging-data --region ap-south-1
```
Expected: `CREATE_COMPLETE` (instance + volume attach take a few minutes).

- [ ] **Step 3: Verify Postgres is actually up (via SSM, no SSH)**

```bash
IID=$(aws ec2 describe-instances --region ap-south-1 --filters Name=tag:Name,Values=fashion-staging-data Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text)
CMD=$(aws ssm send-command --region ap-south-1 --instance-ids $IID --document-name AWS-RunShellScript \
  --parameters 'commands=["docker ps --format {{.Names}}:{{.Status}}","docker exec pg pg_isready -U boutique","df -h /data"]' --query Command.CommandId --output text)
sleep 8
aws ssm get-command-invocation --region ap-south-1 --command-id $CMD --instance-id $IID --query StandardOutputContent --output text
```
Expected: `pg:Up ...`, `accepting connections`, `/data` mounted (~30G). If the container isn't up, read `/var/log/user-data.log` via the same SSM mechanism and fix the template (typical culprits: `!Sub` ate a bash `${}`, device never appeared).

- [ ] **Step 4: Verify protections + backups wiring**

```bash
aws ec2 describe-instance-attribute --instance-id $IID --attribute disableApiTermination --region ap-south-1
# Expected: "Value": true
aws dlm get-lifecycle-policies --region ap-south-1 --query 'Policies[].{id:PolicyId,state:State}'
# Expected: one ENABLED policy
aws s3api get-bucket-replication --bucket fashion-staging-db-backup-741868637305
# Expected: rule to-replica-region Enabled
```

- [ ] **Step 5: Commit**

```bash
git add infra/templates/data.yaml
git commit -m "feat(infra): protected data stack (Postgres EC2, retained EBS, DLM, replicated dumps)"
```

### Task 9: app stack

**Files:**
- Create: `infra/templates/app.yaml`

**Interfaces:**
- Consumes: network exports; data exports (`-data-private-ip`, `-db-secret-arn`).
- Produces: exports `fashion-staging-alb-arn`, `-alb-dns`, `-ecr-uri`, `-asg-name`, `-jwt-secret-arn`, `-seed-admin-secret-arn`, `-seed-customer-secret-arn`, `-api-log-group`; SSM params `/fashion/staging/cors-origins` (placeholder) and `/fashion/staging/api-image-tag` (`bootstrap`). Instances converge once Task 13 pushes an image and sets the tag param.

- [ ] **Step 1: Write the template**

`infra/templates/app.yaml` (same `!Sub`/bash escaping rule as Task 8 — bash vars use `$VAR`, never `${VAR}`):
```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: fashion - app layer (ECR, secrets, ASG behind internal ALB)
Parameters:
  EnvName:
    Type: String
    AllowedValues: [staging, prod]
  AppInstanceType:
    Type: String
    Default: t3.small
  AppMin:
    Type: Number
    Default: 2
  AppMax:
    Type: Number
    Default: 4
  AmiId:
    Type: AWS::SSM::Parameter::Value<AWS::EC2::Image::Id>
    Default: /aws/service/ami-amazon-linux-latest/al2023-ami-kernel-default-x86_64
Resources:
  EcrRepo:
    Type: AWS::ECR::Repository
    Properties:
      RepositoryName: fashion-studio-api
      ImageScanningConfiguration: { ScanOnPush: true }
      LifecyclePolicy:
        LifecyclePolicyText: '{"rules":[{"rulePriority":1,"description":"keep last 10","selection":{"tagStatus":"any","countType":"imageCountMoreThan","countNumber":10},"action":{"type":"expire"}}]}'
  JwtSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      Name: !Sub 'fashion/${EnvName}/jwt-secret'
      GenerateSecretString: { PasswordLength: 48, ExcludePunctuation: true }
  SeedAdminSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      Name: !Sub 'fashion/${EnvName}/seed-admin-password'
      GenerateSecretString: { PasswordLength: 20, ExcludePunctuation: true }
  SeedCustomerSecret:
    Type: AWS::SecretsManager::Secret
    Properties:
      Name: !Sub 'fashion/${EnvName}/seed-customer-password'
      GenerateSecretString: { PasswordLength: 20, ExcludePunctuation: true }
  CorsParam:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub '/fashion/${EnvName}/cors-origins'
      Type: String
      Value: 'http://localhost:5173'
  ImageTagParam:
    Type: AWS::SSM::Parameter
    Properties:
      Name: !Sub '/fashion/${EnvName}/api-image-tag'
      Type: String
      Value: bootstrap
  ApiLogGroup:
    Type: AWS::Logs::LogGroup
    Properties:
      LogGroupName: !Sub '/fashion/${EnvName}/api'
      RetentionInDays: 30
  AppRole:
    Type: AWS::IAM::Role
    Properties:
      AssumeRolePolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: { Service: ec2.amazonaws.com }
            Action: sts:AssumeRole
      ManagedPolicyArns:
        - arn:aws:iam::aws:policy/AmazonSSMManagedInstanceCore
      Policies:
        - PolicyName: app-instance
          PolicyDocument:
            Version: '2012-10-17'
            Statement:
              - Effect: Allow
                Action: ecr:GetAuthorizationToken
                Resource: '*'
              - Effect: Allow
                Action: ['ecr:BatchGetImage', 'ecr:GetDownloadUrlForLayer', 'ecr:BatchCheckLayerAvailability']
                Resource: !GetAtt EcrRepo.Arn
              - Effect: Allow
                Action: secretsmanager:GetSecretValue
                Resource:
                  - !Ref JwtSecret
                  - !Ref SeedAdminSecret
                  - !Ref SeedCustomerSecret
                  - !ImportValue
                    'Fn::Sub': 'fashion-${EnvName}-db-secret-arn'
              - Effect: Allow
                Action: ssm:GetParameter
                Resource: !Sub 'arn:aws:ssm:${AWS::Region}:${AWS::AccountId}:parameter/fashion/${EnvName}/*'
              - Effect: Allow
                Action: ['logs:CreateLogStream', 'logs:PutLogEvents', 'logs:DescribeLogStreams']
                Resource: !GetAtt ApiLogGroup.Arn
  AppInstanceProfile:
    Type: AWS::IAM::InstanceProfile
    Properties:
      Roles: [!Ref AppRole]
  AppLaunchTemplate:
    Type: AWS::EC2::LaunchTemplate
    Properties:
      LaunchTemplateName: !Sub 'fashion-${EnvName}-app'
      LaunchTemplateData:
        ImageId: !Ref AmiId
        InstanceType: !Ref AppInstanceType
        IamInstanceProfile: { Arn: !GetAtt AppInstanceProfile.Arn }
        SecurityGroupIds:
          - !ImportValue
            'Fn::Sub': 'fashion-${EnvName}-app-sg'
        MetadataOptions: { HttpTokens: required, HttpEndpoint: enabled }
        Monitoring: { Enabled: true }
        BlockDeviceMappings:
          - DeviceName: /dev/xvda
            Ebs: { VolumeSize: 20, VolumeType: gp3, Encrypted: true }
        TagSpecifications:
          - ResourceType: instance
            Tags:
              - { Key: Name, Value: !Sub 'fashion-${EnvName}-app' }
              - { Key: Project, Value: fashion-studio }
              - { Key: Env, Value: !Ref EnvName }
        UserData:
          Fn::Base64: !Sub
            - |
              #!/bin/bash
              set -uo pipefail
              exec > /var/log/user-data.log 2>&1
              dnf -y install docker
              systemctl enable --now docker

              REGION=${AWS::Region}
              REPO=${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com/fashion-studio-api
              TAG=$(aws ssm get-parameter --name /fashion/${EnvName}/api-image-tag --region $REGION --query Parameter.Value --output text)
              aws ecr get-login-password --region $REGION | docker login --username AWS --password-stdin ${AWS::AccountId}.dkr.ecr.${AWS::Region}.amazonaws.com
              for i in $(seq 1 80); do docker pull $REPO:$TAG && break; echo "image $TAG not ready, retry $i"; sleep 15; done

              DB_PW=$(aws secretsmanager get-secret-value --secret-id fashion/${EnvName}/db-password --region $REGION --query SecretString --output text)
              JWT=$(aws secretsmanager get-secret-value --secret-id fashion/${EnvName}/jwt-secret --region $REGION --query SecretString --output text)
              CORS=$(aws ssm get-parameter --name /fashion/${EnvName}/cors-origins --region $REGION --query Parameter.Value --output text)
              TOK=$(curl -sX PUT http://169.254.169.254/latest/api/token -H "X-aws-ec2-metadata-token-ttl-seconds: 300")
              IID=$(curl -s -H "X-aws-ec2-metadata-token: $TOK" http://169.254.169.254/latest/meta-data/instance-id)

              docker rm -f api 2>/dev/null || true
              docker run -d --name api --restart always -p 3001:3001 \
                --log-driver awslogs --log-opt awslogs-region=$REGION \
                --log-opt awslogs-group=/fashion/${EnvName}/api --log-opt awslogs-stream=$IID \
                -e NODE_ENV=production -e PORT=3001 \
                -e DATABASE_URL="postgres://boutique:$DB_PW@${DataIp}:5432/boutique" \
                -e JWT_SECRET="$JWT" -e CORS_ORIGINS="$CORS" -e SEED_ON_START=false \
                $REPO:$TAG
            - DataIp: !ImportValue
                'Fn::Sub': 'fashion-${EnvName}-data-private-ip'
  Alb:
    Type: AWS::ElasticLoadBalancingV2::LoadBalancer
    Properties:
      Name: !Sub 'fashion-${EnvName}-alb'
      Scheme: internal
      Type: application
      SecurityGroups:
        - !ImportValue
          'Fn::Sub': 'fashion-${EnvName}-alb-sg'
      Subnets:
        - !ImportValue
          'Fn::Sub': 'fashion-${EnvName}-private-subnet-a'
        - !ImportValue
          'Fn::Sub': 'fashion-${EnvName}-private-subnet-b'
  TargetGroup:
    Type: AWS::ElasticLoadBalancingV2::TargetGroup
    Properties:
      VpcId: !ImportValue
        'Fn::Sub': 'fashion-${EnvName}-vpc'
      Port: 3001
      Protocol: HTTP
      TargetType: instance
      HealthCheckPath: /api/ready
      HealthCheckIntervalSeconds: 15
      HealthCheckTimeoutSeconds: 5
      HealthyThresholdCount: 2
      UnhealthyThresholdCount: 3
      TargetGroupAttributes:
        - { Key: deregistration_delay.timeout_seconds, Value: '30' }
  Listener:
    Type: AWS::ElasticLoadBalancingV2::Listener
    Properties:
      LoadBalancerArn: !Ref Alb
      Port: 80
      Protocol: HTTP
      DefaultActions:
        - { Type: forward, TargetGroupArn: !Ref TargetGroup }
  Asg:
    Type: AWS::AutoScaling::AutoScalingGroup
    UpdatePolicy:
      AutoScalingRollingUpdate:
        MinInstancesInService: 1
        MaxBatchSize: 1
    Properties:
      AutoScalingGroupName: !Sub 'fashion-${EnvName}-app'
      MinSize: !Ref AppMin
      MaxSize: !Ref AppMax
      DesiredCapacity: !Ref AppMin
      HealthCheckType: ELB
      HealthCheckGracePeriod: 300
      VPCZoneIdentifier:
        - !ImportValue
          'Fn::Sub': 'fashion-${EnvName}-private-subnet-a'
        - !ImportValue
          'Fn::Sub': 'fashion-${EnvName}-private-subnet-b'
      TargetGroupARNs: [!Ref TargetGroup]
      LaunchTemplate:
        LaunchTemplateId: !Ref AppLaunchTemplate
        Version: !GetAtt AppLaunchTemplate.LatestVersionNumber
      Tags:
        - { Key: Project, Value: fashion-studio, PropagateAtLaunch: false }
  CpuScaling:
    Type: AWS::AutoScaling::ScalingPolicy
    Properties:
      AutoScalingGroupName: !Ref Asg
      PolicyType: TargetTrackingScaling
      TargetTrackingConfiguration:
        PredefinedMetricSpecification: { PredefinedMetricType: ASGAverageCPUUtilization }
        TargetValue: 60
  Alb5xxAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmDescription: API 5xx spike
      Namespace: AWS/ApplicationELB
      MetricName: HTTPCode_Target_5XX_Count
      Dimensions:
        - { Name: LoadBalancer, Value: !GetAtt Alb.LoadBalancerFullName }
      Statistic: Sum
      Period: 300
      EvaluationPeriods: 1
      Threshold: 10
      ComparisonOperator: GreaterThanOrEqualToThreshold
      TreatMissingData: notBreaching
  UnhealthyHostsAlarm:
    Type: AWS::CloudWatch::Alarm
    Properties:
      AlarmDescription: targets failing /api/ready
      Namespace: AWS/ApplicationELB
      MetricName: UnHealthyHostCount
      Dimensions:
        - { Name: LoadBalancer, Value: !GetAtt Alb.LoadBalancerFullName }
        - { Name: TargetGroup, Value: !GetAtt TargetGroup.TargetGroupFullName }
      Statistic: Maximum
      Period: 60
      EvaluationPeriods: 3
      Threshold: 0
      ComparisonOperator: GreaterThanThreshold
      TreatMissingData: notBreaching
Outputs:
  AlbArn:
    Value: !Ref Alb
    Export: { Name: !Sub 'fashion-${EnvName}-alb-arn' }
  AlbDns:
    Value: !GetAtt Alb.DNSName
    Export: { Name: !Sub 'fashion-${EnvName}-alb-dns' }
  EcrUri:
    Value: !GetAtt EcrRepo.RepositoryUri
    Export: { Name: !Sub 'fashion-${EnvName}-ecr-uri' }
  AsgName:
    Value: !Ref Asg
    Export: { Name: !Sub 'fashion-${EnvName}-asg-name' }
  JwtSecretArn:
    Value: !Ref JwtSecret
    Export: { Name: !Sub 'fashion-${EnvName}-jwt-secret-arn' }
  SeedAdminSecretArn:
    Value: !Ref SeedAdminSecret
    Export: { Name: !Sub 'fashion-${EnvName}-seed-admin-secret-arn' }
  SeedCustomerSecretArn:
    Value: !Ref SeedCustomerSecret
    Export: { Name: !Sub 'fashion-${EnvName}-seed-customer-secret-arn' }
  ApiLogGroup:
    Value: !Ref ApiLogGroup
    Export: { Name: !Sub 'fashion-${EnvName}-api-log-group' }
```

- [ ] **Step 2: Validate + deploy**

```bash
aws cloudformation validate-template --template-body file://infra/templates/app.yaml --region ap-south-1
aws cloudformation deploy --region ap-south-1 --stack-name fashion-staging-app \
  --template-file infra/templates/app.yaml --capabilities CAPABILITY_NAMED_IAM \
  --parameter-overrides EnvName=staging AppInstanceType=t3.small AppMin=2 AppMax=4 --no-fail-on-empty-changeset
aws cloudformation update-termination-protection --enable-termination-protection --stack-name fashion-staging-app --region ap-south-1
```
Expected: `CREATE_COMPLETE`. Instances will boot and RETRY-LOOP on the missing `bootstrap` image — that's by design; targets stay unhealthy until Task 13 pushes an image. Do NOT wait for target health here; just confirm the ASG has 2 InService instances at the EC2 level:
```bash
aws autoscaling describe-auto-scaling-groups --auto-scaling-group-names fashion-staging-app --region ap-south-1 --query 'AutoScalingGroups[0].Instances[].{id:InstanceId,state:LifecycleState}'
```

- [ ] **Step 3: Commit**

```bash
git add infra/templates/app.yaml
git commit -m "feat(infra): app stack (ECR, secrets, ASG behind internal ALB)"
```

### Task 10: WAF stack (us-east-1)

**Files:**
- Create: `infra/templates/waf.yaml`

**Interfaces:**
- Produces: stack `fashion-staging-waf` in us-east-1; output `WebAclArn` passed to Task 11 as a parameter (cross-region, so via CLI not export).

- [ ] **Step 1: Write the template**

`infra/templates/waf.yaml`:
```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: fashion - CloudFront WAF (deploy in us-east-1; CLOUDFRONT scope requires it)
Parameters:
  EnvName:
    Type: String
    AllowedValues: [staging, prod]
Resources:
  WebAcl:
    Type: AWS::WAFv2::WebACL
    Properties:
      Name: !Sub 'fashion-${EnvName}'
      Scope: CLOUDFRONT
      DefaultAction: { Allow: {} }
      VisibilityConfig:
        SampledRequestsEnabled: true
        CloudWatchMetricsEnabled: true
        MetricName: !Sub 'fashion-${EnvName}-acl'
      Rules:
        - Name: rate-limit-per-ip
          Priority: 0
          Action: { Block: {} }
          Statement:
            RateBasedStatement: { Limit: 2000, AggregateKeyType: IP }
          VisibilityConfig:
            SampledRequestsEnabled: true
            CloudWatchMetricsEnabled: true
            MetricName: !Sub 'fashion-${EnvName}-rate'
        - Name: aws-common
          Priority: 1
          OverrideAction: { None: {} }
          Statement:
            ManagedRuleGroupStatement:
              VendorName: AWS
              Name: AWSManagedRulesCommonRuleSet
          VisibilityConfig:
            SampledRequestsEnabled: true
            CloudWatchMetricsEnabled: true
            MetricName: !Sub 'fashion-${EnvName}-common'
Outputs:
  WebAclArn:
    Value: !GetAtt WebAcl.Arn
```

- [ ] **Step 2: Validate + deploy + commit**

```bash
aws cloudformation validate-template --template-body file://infra/templates/waf.yaml --region us-east-1
aws cloudformation deploy --region us-east-1 --stack-name fashion-staging-waf \
  --template-file infra/templates/waf.yaml --parameter-overrides EnvName=staging --no-fail-on-empty-changeset
aws cloudformation update-termination-protection --enable-termination-protection --stack-name fashion-staging-waf --region us-east-1
git add infra/templates/waf.yaml && git commit -m "feat(infra): CloudFront WAF stack (rate limit + managed common rules)"
```
Known false-positive risk: `SizeRestrictions_BODY` in the common rule set blocks bodies >8KB — all API bodies here are small JSON, fine. If Task 14's E2E hits a managed-rule block (403 with `x-amzn-waf-*` headers), add a `RuleActionOverrides` entry setting ONLY the offending sub-rule to `Count`, redeploy, and document it in the audit.

### Task 11: edge stack (S3+CloudFront ×3, API distro via VPC origin)

**Files:**
- Create: `infra/templates/edge.yaml`

**Interfaces:**
- Consumes: `fashion-staging-alb-arn`, `-alb-dns` exports; `WebAclArn` (parameter, from Task 10 output).
- Produces: outputs `StorefrontDomain`, `AdminDomain`, `SocialsDomain`, `ApiDomain` (all `*.cloudfront.net`), `StorefrontBucket`, `AdminBucket`, `SocialsBucket`, and distribution IDs `StorefrontDistId`, `AdminDistId`, `SocialsDistId` — consumed by the deploy script (Task 12/13) for SPA publishing, CORS, and E2E targets.

- [ ] **Step 1: Write the template**

`infra/templates/edge.yaml`. The three SPA blocks are IDENTICAL except logical-ID prefix (`Storefront`/`Admin`/`Socials`) and bucket suffix (`web-storefront`/`web-admin`/`web-socials`); the Admin distro uses `AdminHeadersPolicy` (adds noindex), the other two use `SpaHeadersPolicy`. Write all three out in full — no YAML anchors (CloudFormation ignores them across resources).
```yaml
AWSTemplateFormatVersion: '2010-09-09'
Description: fashion - edge layer (3 SPA distros + API distro over VPC origin + WAF attach)
Parameters:
  EnvName:
    Type: String
    AllowedValues: [staging, prod]
  WafWebAclArn:
    Type: String
Resources:
  Oac:
    Type: AWS::CloudFront::OriginAccessControl
    Properties:
      OriginAccessControlConfig:
        Name: !Sub 'fashion-${EnvName}-oac'
        OriginAccessControlOriginType: s3
        SigningBehavior: always
        SigningProtocol: sigv4
  SpaHeadersPolicy:
    Type: AWS::CloudFront::ResponseHeadersPolicy
    Properties:
      ResponseHeadersPolicyConfig:
        Name: !Sub 'fashion-${EnvName}-spa-headers'
        SecurityHeadersConfig:
          StrictTransportSecurity: { AccessControlMaxAgeSec: 63072000, IncludeSubdomains: true, Override: true }
          ContentTypeOptions: { Override: true }
          FrameOptions: { FrameOption: DENY, Override: true }
          ReferrerPolicy: { ReferrerPolicy: strict-origin-when-cross-origin, Override: true }
          ContentSecurityPolicy:
            Override: true
            ContentSecurityPolicy: "default-src 'self'; script-src 'self' https://accounts.google.com; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com https://accounts.google.com; font-src https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src https:; frame-src https://accounts.google.com; object-src 'none'; base-uri 'self'"
  AdminHeadersPolicy:
    Type: AWS::CloudFront::ResponseHeadersPolicy
    Properties:
      ResponseHeadersPolicyConfig:
        Name: !Sub 'fashion-${EnvName}-admin-headers'
        SecurityHeadersConfig:
          StrictTransportSecurity: { AccessControlMaxAgeSec: 63072000, IncludeSubdomains: true, Override: true }
          ContentTypeOptions: { Override: true }
          FrameOptions: { FrameOption: DENY, Override: true }
          ReferrerPolicy: { ReferrerPolicy: strict-origin-when-cross-origin, Override: true }
          ContentSecurityPolicy:
            Override: true
            ContentSecurityPolicy: "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src https://fonts.gstatic.com data:; img-src 'self' data: https:; connect-src https:; object-src 'none'; base-uri 'self'"
        CustomHeadersConfig:
          Items:
            - { Header: X-Robots-Tag, Value: noindex, Override: true }
  StorefrontBucket:
    Type: AWS::S3::Bucket
    Properties:
      BucketName: !Sub 'fashion-${EnvName}-web-storefront-${AWS::AccountId}'
      BucketEncryption:
        ServerSideEncryptionConfiguration:
          - ServerSideEncryptionByDefault: { SSEAlgorithm: AES256 }
      PublicAccessBlockConfiguration:
        BlockPublicAcls: true
        BlockPublicPolicy: true
        IgnorePublicAcls: true
        RestrictPublicBuckets: true
  StorefrontDist:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Enabled: true
        Comment: !Sub 'fashion-${EnvName} storefront'
        DefaultRootObject: index.html
        HttpVersion: http2
        PriceClass: PriceClass_200
        WebACLId: !Ref WafWebAclArn
        Origins:
          - Id: s3
            DomainName: !GetAtt StorefrontBucket.RegionalDomainName
            OriginAccessControlId: !GetAtt Oac.Id
            S3OriginConfig: { OriginAccessIdentity: '' }
        DefaultCacheBehavior:
          TargetOriginId: s3
          ViewerProtocolPolicy: redirect-to-https
          AllowedMethods: [GET, HEAD]
          Compress: true
          CachePolicyId: 658327ea-f89d-4fab-a63d-7e88639e58f6   # Managed-CachingOptimized
          ResponseHeadersPolicyId: !Ref SpaHeadersPolicy
        CustomErrorResponses:
          - { ErrorCode: 403, ResponseCode: 200, ResponsePagePath: /index.html, ErrorCachingMinTTL: 10 }
          - { ErrorCode: 404, ResponseCode: 200, ResponsePagePath: /index.html, ErrorCachingMinTTL: 10 }
  StorefrontBucketPolicy:
    Type: AWS::S3::BucketPolicy
    Properties:
      Bucket: !Ref StorefrontBucket
      PolicyDocument:
        Version: '2012-10-17'
        Statement:
          - Effect: Allow
            Principal: { Service: cloudfront.amazonaws.com }
            Action: s3:GetObject
            Resource: !Sub '${StorefrontBucket.Arn}/*'
            Condition:
              StringEquals:
                AWS:SourceArn: !Sub 'arn:aws:cloudfront::${AWS::AccountId}:distribution/${StorefrontDist}'
  # AdminBucket / AdminDist / AdminBucketPolicy: exact copies of the three
  # Storefront resources with prefix Admin, bucket suffix web-admin, comment
  # 'fashion-${EnvName} admin', and ResponseHeadersPolicyId: !Ref AdminHeadersPolicy
  # SocialsBucket / SocialsDist / SocialsBucketPolicy: exact copies with prefix
  # Socials, bucket suffix web-socials, comment 'fashion-${EnvName} socials',
  # ResponseHeadersPolicyId: !Ref SpaHeadersPolicy
  ApiVpcOrigin:
    Type: AWS::CloudFront::VpcOrigin
    Properties:
      VpcOriginEndpointConfig:
        Name: !Sub 'fashion-${EnvName}-api-vpco'
        Arn: !ImportValue
          'Fn::Sub': 'fashion-${EnvName}-alb-arn'
        HTTPPort: 80
        OriginProtocolPolicy: http-only
  ApiDist:
    Type: AWS::CloudFront::Distribution
    Properties:
      DistributionConfig:
        Enabled: true
        Comment: !Sub 'fashion-${EnvName} api'
        HttpVersion: http2
        PriceClass: PriceClass_200
        WebACLId: !Ref WafWebAclArn
        Origins:
          - Id: alb
            DomainName: !ImportValue
              'Fn::Sub': 'fashion-${EnvName}-alb-dns'
            VpcOriginConfig:
              VpcOriginId: !GetAtt ApiVpcOrigin.Id
        DefaultCacheBehavior:
          TargetOriginId: alb
          ViewerProtocolPolicy: redirect-to-https
          AllowedMethods: [GET, HEAD, OPTIONS, PUT, POST, PATCH, DELETE]
          Compress: true
          CachePolicyId: 4135ea2d-6df8-44a3-9df3-4b5a84be39ad          # Managed-CachingDisabled
          OriginRequestPolicyId: b689b0a8-53d0-40ab-baf2-68738e2966ac  # Managed-AllViewerExceptHostHeader
Outputs:
  StorefrontDomain: { Value: !GetAtt StorefrontDist.DomainName }
  AdminDomain: { Value: !GetAtt AdminDist.DomainName }
  SocialsDomain: { Value: !GetAtt SocialsDist.DomainName }
  ApiDomain: { Value: !GetAtt ApiDist.DomainName }
  StorefrontBucket: { Value: !Ref StorefrontBucket }
  AdminBucket: { Value: !Ref AdminBucket }
  SocialsBucket: { Value: !Ref SocialsBucket }
  StorefrontDistId: { Value: !Ref StorefrontDist }
  AdminDistId: { Value: !Ref AdminDist }
  SocialsDistId: { Value: !Ref SocialsDist }
```
(The two commented blocks are instructions to the implementer: write those nine resources out in full, mechanical copies — the plan omits them only to avoid triple-repeating identical YAML.)

- [ ] **Step 2: Validate + deploy**

```bash
aws cloudformation validate-template --template-body file://infra/templates/edge.yaml --region ap-south-1
WAF_ARN=$(aws cloudformation describe-stacks --region us-east-1 --stack-name fashion-staging-waf --query "Stacks[0].Outputs[?OutputKey=='WebAclArn'].OutputValue" --output text)
aws cloudformation deploy --region ap-south-1 --stack-name fashion-staging-edge \
  --template-file infra/templates/edge.yaml --parameter-overrides EnvName=staging WafWebAclArn=$WAF_ARN --no-fail-on-empty-changeset
aws cloudformation update-termination-protection --enable-termination-protection --stack-name fashion-staging-edge --region ap-south-1
```
Expected: `CREATE_COMPLETE` — SLOW (VPC origin ~15 min, 4 distros ~5-10 min each; total can reach 30-40 min). If `AWS::CloudFront::VpcOrigin` fails as unsupported: fall back per spec §1 — make the ALB internet-facing in the public subnets, restrict `AlbSg` ingress to the CloudFront origin-facing managed prefix list (`aws ec2 describe-managed-prefix-lists --filters Name=prefix-list-name,Values=com.amazonaws.global.cloudfront.origin-facing`), replace the VPC origin with a `CustomOriginConfig` (HTTPPort 80, OriginProtocolPolicy http-only) + `OriginCustomHeaders` shared secret and an ALB listener rule that 403s requests missing it. Document the deviation in the audit doc.

- [ ] **Step 3: Verify + commit**

```bash
API_DOMAIN=$(aws cloudformation describe-stacks --region ap-south-1 --stack-name fashion-staging-edge --query "Stacks[0].Outputs[?OutputKey=='ApiDomain'].OutputValue" --output text)
curl -s https://$API_DOMAIN/api/health
# Expected: {"status":"ok"} — ONLY if Task 13 already pushed an image; before that expect 502/503 (targets unhealthy). Either response proves the edge→ALB path resolves.
git add infra/templates/edge.yaml && git commit -m "feat(infra): edge stack (3 SPA distros + API distro via VPC origin, WAF attached)"
```

### Task 12: Params files, deploy script, runbook

**Files:**
- Create: `infra/params/staging.env`, `infra/params/prod.env`, `infra/deploy.sh` (chmod +x), `infra/README.md`

**Interfaces:**
- Consumes: all five templates and their outputs/exports.
- Produces: `infra/deploy.sh <env> <command>` with commands `stacks|image|seed|spas|cors|refresh|verify|all` used by Tasks 13-15.

- [ ] **Step 1: Write params files**

`infra/params/staging.env`:
```bash
ENV_NAME=staging
PRIMARY_REGION=ap-south-1
REPLICA_REGION=ap-southeast-1
WAF_REGION=us-east-1
APP_INSTANCE_TYPE=t3.small
DATA_INSTANCE_TYPE=t3.small
APP_MIN=2
APP_MAX=4
```
`infra/params/prod.env` (written, NEVER deployed by this plan):
```bash
ENV_NAME=prod
PRIMARY_REGION=ap-south-1
REPLICA_REGION=ap-southeast-1
WAF_REGION=us-east-1
APP_INSTANCE_TYPE=t3.medium
DATA_INSTANCE_TYPE=t3.medium
APP_MIN=2
APP_MAX=6
```

- [ ] **Step 2: Write infra/deploy.sh**

```bash
#!/usr/bin/env bash
# fashion-studio infra driver. Usage: infra/deploy.sh <env> <command>
# Commands: stacks | image | seed | spas | cors | refresh | verify | all
set -euo pipefail
cd "$(dirname "$0")/.."

ENV="${1:?usage: deploy.sh <env> <command>}"
CMD="${2:?usage: deploy.sh <env> <command>}"
source "infra/params/$ENV.env"

stack_out() { # region stack output-key
  aws cloudformation describe-stacks --region "$1" --stack-name "$2" \
    --query "Stacks[0].Outputs[?OutputKey=='$3'].OutputValue" --output text
}

deploy_stack() { # region name template extra-params...
  local region="$1" name="$2" template="$3"; shift 3
  aws cloudformation validate-template --template-body "file://$template" --region "$region" > /dev/null
  aws cloudformation deploy --region "$region" --stack-name "$name" --template-file "$template" \
    --capabilities CAPABILITY_NAMED_IAM --no-fail-on-empty-changeset \
    --parameter-overrides EnvName="$ENV_NAME" "$@"
  aws cloudformation update-termination-protection --enable-termination-protection \
    --stack-name "$name" --region "$region"
}

cmd_stacks() {
  deploy_stack "$REPLICA_REGION" "fashion-$ENV_NAME-backup-replica" infra/templates/backup-replica.yaml
  deploy_stack "$PRIMARY_REGION" "fashion-$ENV_NAME-network" infra/templates/network.yaml
  local replica_arn
  replica_arn=$(stack_out "$REPLICA_REGION" "fashion-$ENV_NAME-backup-replica" ReplicaBucketArn)
  deploy_stack "$PRIMARY_REGION" "fashion-$ENV_NAME-data" infra/templates/data.yaml \
    DataInstanceType="$DATA_INSTANCE_TYPE" ReplicaBucketArn="$replica_arn"
  deploy_stack "$PRIMARY_REGION" "fashion-$ENV_NAME-app" infra/templates/app.yaml \
    AppInstanceType="$APP_INSTANCE_TYPE" AppMin="$APP_MIN" AppMax="$APP_MAX"
  deploy_stack "$WAF_REGION" "fashion-$ENV_NAME-waf" infra/templates/waf.yaml
  local waf_arn
  waf_arn=$(stack_out "$WAF_REGION" "fashion-$ENV_NAME-waf" WebAclArn)
  deploy_stack "$PRIMARY_REGION" "fashion-$ENV_NAME-edge" infra/templates/edge.yaml WafWebAclArn="$waf_arn"
}

cmd_image() {
  local ecr tag acct
  ecr=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-app" EcrUri)
  tag=$(git rev-parse --short HEAD)
  acct="${ecr%%.*}"
  aws ecr get-login-password --region "$PRIMARY_REGION" \
    | docker login --username AWS --password-stdin "$acct.dkr.ecr.$PRIMARY_REGION.amazonaws.com"
  docker build --platform linux/amd64 -t "$ecr:$tag" backend/
  docker push "$ecr:$tag"
  aws ssm put-parameter --region "$PRIMARY_REGION" --name "/fashion/$ENV_NAME/api-image-tag" \
    --type String --value "$tag" --overwrite
  echo "pushed $ecr:$tag and updated image-tag param"
}

app_instance() { # first InService instance of the ASG
  aws autoscaling describe-auto-scaling-groups --region "$PRIMARY_REGION" \
    --auto-scaling-group-names "fashion-$ENV_NAME-app" \
    --query 'AutoScalingGroups[0].Instances[?LifecycleState==`InService`].InstanceId | [0]' --output text
}

run_ssm() { # instance-id command...
  local iid="$1"; shift
  local cid
  cid=$(aws ssm send-command --region "$PRIMARY_REGION" --instance-ids "$iid" \
    --document-name AWS-RunShellScript --parameters commands="$*" \
    --query Command.CommandId --output text)
  aws ssm wait command-executed --region "$PRIMARY_REGION" --command-id "$cid" --instance-id "$iid" || true
  aws ssm get-command-invocation --region "$PRIMARY_REGION" --command-id "$cid" --instance-id "$iid" \
    --query '{status:Status,out:StandardOutputContent,err:StandardErrorContent}' --output json
}

cmd_seed() {
  local iid
  iid=$(app_instance)
  run_ssm "$iid" '[
    "REGION='"$PRIMARY_REGION"'",
    "ACCT=$(aws sts get-caller-identity --query Account --output text)",
    "REPO=$ACCT.dkr.ecr.$REGION.amazonaws.com/fashion-studio-api",
    "TAG=$(aws ssm get-parameter --name /fashion/'"$ENV_NAME"'/api-image-tag --region $REGION --query Parameter.Value --output text)",
    "DB_PW=$(aws secretsmanager get-secret-value --secret-id fashion/'"$ENV_NAME"'/db-password --region $REGION --query SecretString --output text)",
    "ADMIN_PW=$(aws secretsmanager get-secret-value --secret-id fashion/'"$ENV_NAME"'/seed-admin-password --region $REGION --query SecretString --output text)",
    "CUST_PW=$(aws secretsmanager get-secret-value --secret-id fashion/'"$ENV_NAME"'/seed-customer-password --region $REGION --query SecretString --output text)",
    "DATA_IP=$(aws cloudformation list-exports --region $REGION --query \"Exports[?Name=='"'"'fashion-'"$ENV_NAME"'-data-private-ip'"'"'].Value\" --output text)",
    "docker run --rm -e DATABASE_URL=postgres://boutique:$DB_PW@$DATA_IP:5432/boutique -e SEED_ADMIN_PASSWORD=$ADMIN_PW -e SEED_CUSTOMER_PASSWORD=$CUST_PW $REPO:$TAG node dist/seed-cli.js"
  ]'
}

cmd_spas() {
  local api_domain
  api_domain=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-edge" ApiDomain)
  for app in frontend:Storefront admin:Admin socials:Socials; do
    local dir="${app%%:*}" key="${app##*:}"
    local bucket dist
    bucket=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-edge" "${key}Bucket")
    dist=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-edge" "${key}DistId")
    (cd "$dir" && rm -rf dist && VITE_API_URL="https://$api_domain" npm run build)
    aws s3 sync "$dir/dist" "s3://$bucket" --delete --region "$PRIMARY_REGION"
    aws cloudfront create-invalidation --distribution-id "$dist" --paths '/*' > /dev/null
    echo "published $dir -> $bucket"
  done
}

cmd_cors() {
  local sf admin socials origins
  sf=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-edge" StorefrontDomain)
  admin=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-edge" AdminDomain)
  socials=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-edge" SocialsDomain)
  origins="https://$sf,https://$admin,https://$socials"
  aws ssm put-parameter --region "$PRIMARY_REGION" --name "/fashion/$ENV_NAME/cors-origins" \
    --type String --value "$origins" --overwrite
  echo "cors-origins = $origins (run refresh to apply)"
}

cmd_refresh() {
  aws autoscaling start-instance-refresh --region "$PRIMARY_REGION" \
    --auto-scaling-group-name "fashion-$ENV_NAME-app" \
    --preferences MinHealthyPercentage=50,InstanceWarmup=300
  echo "instance refresh started; watch: aws autoscaling describe-instance-refreshes --auto-scaling-group-name fashion-$ENV_NAME-app --region $PRIMARY_REGION"
}

cmd_verify() {
  for spec in "$REPLICA_REGION:backup-replica" "$PRIMARY_REGION:network" "$PRIMARY_REGION:data" \
              "$PRIMARY_REGION:app" "$WAF_REGION:waf" "$PRIMARY_REGION:edge"; do
    local region="${spec%%:*}" name="fashion-$ENV_NAME-${spec##*:}"
    echo "== $name ($region)"
    aws cloudformation describe-stacks --region "$region" --stack-name "$name" \
      --query 'Stacks[0].{status:StackStatus,protected:EnableTerminationProtection}' --output json
    aws cloudformation describe-stack-resources --region "$region" --stack-name "$name" \
      --query 'StackResources[].{type:ResourceType,id:LogicalResourceId,status:ResourceStatus}' --output table
  done
}

cmd_all() {
  cmd_stacks
  cmd_image
  cmd_cors
  cmd_refresh
  echo "wait for the instance refresh to finish, then run: seed, spas, verify"
}

"cmd_$CMD"
```
Note for the implementer: the `cmd_seed` heredoc-in-JSON quoting is the hairiest part — after writing it, test the quoting by echoing the rendered parameter (`aws ssm send-command ... --cli-input-json` is an acceptable refactor if the inline form fights back; keep behavior identical).

- [ ] **Step 3: Write infra/README.md**

Cover, briefly (~60 lines): stack map + deploy order, the one-command flows (`infra/deploy.sh staging all`, then `seed`/`spas`/`verify`), how secrets/params flow into instances, the data-layer protection story (termination protection, Retain, DisableApiTermination, DLM, pg_dump+CRR), the restore runbook (stop app ASG → new data instance or snapshot-restored volume → re-attach → update `fashion-staging-data-private-ip` consumers via stack update → refresh), and the prod checklist (deploy `prod.env`, real domain + ACM + origin TLS, Razorpay per PRODUCTION-TODO #1).

- [ ] **Step 4: Sanity-check + commit**

```bash
chmod +x infra/deploy.sh
bash -n infra/deploy.sh   # Expected: no output (syntax OK)
./infra/deploy.sh staging verify   # Expected: 6 stacks listed, all *_COMPLETE, protected: true
git add infra/params infra/deploy.sh infra/README.md
git commit -m "feat(infra): deploy driver, per-env params, runbook"
```

---

## Phase C — Execute the deployment

### Task 13: Full staging deployment + resource inventory

**Files:**
- Create: `docs/verification/staging-resources.md`

**Interfaces:**
- Consumes: everything from Phases A-B (all committed; templates already deployed once by Tasks 6-11 — this task converges the app onto the hardened image and publishes the SPAs).
- Produces: a running staging environment; `docs/verification/staging-resources.md` listing every resource; the four CloudFront URLs recorded at the top of that file (E2E and audit tasks read them from there).

- [ ] **Step 1: Build + push the API image, apply CORS, refresh**

```bash
./infra/deploy.sh staging image
./infra/deploy.sh staging cors
./infra/deploy.sh staging refresh
```
Wait for the refresh: poll `aws autoscaling describe-instance-refreshes --auto-scaling-group-name fashion-staging-app --region ap-south-1 --query 'InstanceRefreshes[0].Status'` until `Successful` (5-10 min). Then confirm targets healthy:
```bash
TG=$(aws autoscaling describe-auto-scaling-groups --region ap-south-1 --auto-scaling-group-names fashion-staging-app --query 'AutoScalingGroups[0].TargetGroupARNs[0]' --output text)
aws elbv2 describe-target-health --region ap-south-1 --target-group-arn $TG --query 'TargetHealthDescriptions[].TargetHealth.State'
```
Expected: `["healthy","healthy"]`. If unhealthy: read container logs — `aws logs tail /fashion/staging/api --region ap-south-1 --since 15m`. Typical failures: JWT secret too short (won't happen — 48 chars), DB unreachable (check DataSg/AppSg rules), image pull loop (check tag param).

- [ ] **Step 2: Seed staging data**

```bash
./infra/deploy.sh staging seed
```
Expected JSON: `status: Success`, output containing `Applied migrations:` (3 files) and `Seeded catalog + users`.

- [ ] **Step 3: Smoke-test all four URLs**

```bash
API=$(aws cloudformation describe-stacks --region ap-south-1 --stack-name fashion-staging-edge --query "Stacks[0].Outputs[?OutputKey=='ApiDomain'].OutputValue" --output text)
curl -s https://$API/api/health          # {"status":"ok"}
curl -s https://$API/api/ready           # {"status":"ready"}
curl -s https://$API/api/products | head -c 200   # JSON product list (seeded)
```
Then publish the SPAs and smoke them:
```bash
./infra/deploy.sh staging spas
for KEY in StorefrontDomain AdminDomain SocialsDomain; do
  D=$(aws cloudformation describe-stacks --region ap-south-1 --stack-name fashion-staging-edge --query "Stacks[0].Outputs[?OutputKey=='$KEY'].OutputValue" --output text)
  echo "$KEY https://$D -> $(curl -s -o /dev/null -w '%{http_code}' https://$D/)"
done
```
Expected: three `200`s. Also verify the SPA deep-link rewrite: `curl -s -o /dev/null -w '%{http_code}' https://$STOREFRONT/shop` → `200`.

- [ ] **Step 4: Write the resource inventory**

```bash
./infra/deploy.sh staging verify > /tmp/staging-verify.txt
```
Create `docs/verification/staging-resources.md`: date, the four URLs, then per-stack tables from the verify output (status, termination protection, resource list). Every stack must show `*_COMPLETE` and `protected: true`.

- [ ] **Step 5: Commit**

```bash
git add docs/verification/staging-resources.md
git commit -m "docs(verify): staging resource inventory - all stacks live + protected"
```

---

## Phase D — Prove it

### Task 14: E2E + API verification against staging

**Files:**
- Create: `docs/verification/staging-e2e.md`
- Modify (only if a spec breaks on real-network latency): individual files under `e2e/tests/` — timing fixes only, no assertion weakening.

**Interfaces:**
- Consumes: staging URLs from `docs/verification/staging-resources.md`; `E2E_*` envs from Task 5; seed-admin password secret from Task 9.

- [ ] **Step 1: Run the API contract script against staging**

```bash
API_DOMAIN=$(aws cloudformation describe-stacks --region ap-south-1 --stack-name fashion-staging-edge --query "Stacks[0].Outputs[?OutputKey=='ApiDomain'].OutputValue" --output text)
API=https://$API_DOMAIN bash scripts/verify-api.sh
```
Expected: script's full check list passes (it uses the seeded catalog + demo creds; export `E2E_ADMIN_PASSWORD`-equivalent env if the script needs admin auth — read its header to see which envs it takes; the staging admin password comes from `aws secretsmanager get-secret-value --secret-id fashion/staging/seed-admin-password --region ap-south-1 --query SecretString --output text`).

- [ ] **Step 2: Run the full Playwright suite against staging**

```bash
cd e2e
E2E_BASE_URL=https://$STOREFRONT_DOMAIN \
E2E_ADMIN_URL=https://$ADMIN_DOMAIN \
E2E_API_URL=https://$API_DOMAIN \
E2E_ADMIN_PASSWORD=$(aws secretsmanager get-secret-value --secret-id fashion/staging/seed-admin-password --region ap-south-1 --query SecretString --output text) \
npx playwright test
```
Expected: all specs pass on both projects (desktop 8, mobile @mobile subset). Triage failures honestly:
- WAF 403 → per Task 10, override ONLY the offending managed sub-rule to Count; rerun.
- Rate-limit 429 on auth → the suite logs in more than 30×/min from one IP; bump the auth limiter mount in `backend/src/app.ts` to `max: 60`, rebuild+push image (`deploy.sh staging image && ... refresh`), rerun. Do not remove the limiter.
- Timeouts on cold CloudFront → re-run once (retries: 1 already); persistent timeouts get targeted `expect` timeout bumps in the affected spec only.

- [ ] **Step 3: Record results**

`docs/verification/staging-e2e.md`: date, target URLs, `verify-api.sh` summary, Playwright reporter output (spec-by-spec pass list), any WAF/limiter adjustments made and why. ALL TESTS MUST BE GREEN before this task completes — a red suite is a blocker, not a footnote.

- [ ] **Step 4: Commit**

```bash
git add docs/verification/staging-e2e.md e2e/ backend/src/app.ts 2>/dev/null || git add docs/verification/staging-e2e.md e2e/
git commit -m "test(e2e): full suite green against staging (deployed apps)"
```

### Task 15: Security audit + deletion-protection demonstration

**Files:**
- Create: `docs/verification/staging-security-audit.md`

**Interfaces:**
- Consumes: the live environment; PRODUCTION-TODO.md item numbers for mapping open findings.

- [ ] **Step 1: Infra probes (all read-only)**

Run and capture each:
```bash
# Public exposure: no instance should have a public IP
aws ec2 describe-instances --region ap-south-1 --filters Name=tag:Project,Values=fashion-studio \
  --query 'Reservations[].Instances[].{id:InstanceId,pub:PublicIpAddress,imds:MetadataOptions.HttpTokens}'
# Expected: pub null everywhere, imds "required" everywhere

# SG audit: no 0.0.0.0/0 ingress anywhere
aws ec2 describe-security-groups --region ap-south-1 --filters Name=tag:Name,Values='fashion-staging-*' \
  --query 'SecurityGroups[].{name:GroupName,in:IpPermissions}'

# S3: BPA on all five buckets
for B in fashion-staging-db-backup-741868637305 fashion-staging-web-storefront-741868637305 fashion-staging-web-admin-741868637305 fashion-staging-web-socials-741868637305; do
  echo "$B: $(aws s3api get-public-access-block --bucket $B --query PublicAccessBlockConfiguration --output json | tr -d '\n ')"
done
aws s3api get-public-access-block --bucket fashion-staging-db-backup-replica-741868637305

# Encryption: volumes + snapshots
aws ec2 describe-volumes --region ap-south-1 --filters Name=tag:Env,Values=staging --query 'Volumes[].{id:VolumeId,enc:Encrypted}'

# IAM: flag wildcard actions in the three instance/replication roles (manual review of the policies)
aws iam list-role-policies --role-name <each fashion-staging role from describe-stack-resources>
```
Also run the CloudFormation compliance scan on all five templates via the AWS IaC tooling (`check_cloudformation_template_compliance`), and include its findings verbatim.

- [ ] **Step 2: App-level probes against the live API**

```bash
API=https://<api-domain>
# Security headers present?
curl -sI $API/api/health | grep -iE 'strict-transport|x-content-type|x-frame'
# Authz: unauthenticated + customer-token access to admin routes must 401/403
curl -s -o /dev/null -w '%{http_code}\n' $API/api/admin/products                     # 401
TOKEN=$(curl -s $API/api/auth/login -H 'content-type: application/json' -d '{"email":"aanya@example.com","password":"<customer secret>"}' | jq -r .token)
curl -s -o /dev/null -w '%{http_code}\n' -H "Authorization: Bearer $TOKEN" $API/api/admin/products   # 403
# IDOR: fetch an order with the wrong email must 404/403 (ce91303 fix)
# Rate limit: 35 rapid logins from one IP → expect 429s in the tail
for i in $(seq 1 35); do curl -s -o /dev/null -w '%{http_code} ' $API/api/auth/login -H 'content-type: application/json' -d '{"email":"x@x.com","password":"wrongwrong"}'; done; echo
# Body limit: >100KB JSON → 413
python3 -c "print('{\"x\":\"' + 'a'*120000 + '\"}')" > /tmp/big.json
curl -s -o /dev/null -w '%{http_code}\n' $API/api/auth/login -H 'content-type: application/json' --data @/tmp/big.json   # 413
# TLS: storefront/admin/socials/api all redirect http->https (CloudFront)
```

- [ ] **Step 3: Deletion-protection demonstration (expected-failure attempts)**

Capture command + full error output for each:
```bash
aws cloudformation delete-stack --stack-name fashion-staging-data --region ap-south-1
# Expected: ValidationError ... TerminationProtection is enabled
IID=$(aws ec2 describe-instances --region ap-south-1 --filters Name=tag:Name,Values=fashion-staging-data Name=instance-state-name,Values=running --query 'Reservations[0].Instances[0].InstanceId' --output text)
aws ec2 terminate-instances --instance-ids $IID --region ap-south-1
# Expected: OperationNotPermitted (disableApiTermination)
VOL=$(aws ec2 describe-volumes --region ap-south-1 --filters Name=tag:Name,Values=fashion-staging-pgdata --query 'Volumes[0].VolumeId' --output text)
aws ec2 delete-volume --volume-id $VOL --region ap-south-1
# Expected: VolumeInUse
```
Also verify backups exist by now: `aws ec2 describe-snapshots --owner-ids self --region ap-south-1 --filters Name=tag:dlm:backup,Values=fashion-staging-data --query 'Snapshots[].StartTime'` (≥1 after 4h; if the audit runs sooner, note "first DLM window pending" with the policy state as evidence) and `aws s3 ls s3://fashion-staging-db-backup-741868637305/dumps/` (nightly; same note if pending — optionally trigger one manually via SSM: `/usr/local/bin/pg-backup.sh`, then check both bucket and replica bucket).

- [ ] **Step 4: Write the audit report**

`docs/verification/staging-security-audit.md` sections:
1. **Scope & method** — what was probed, when.
2. **Infra findings** — each probe, result, PASS/FAIL verdict.
3. **App findings** — headers, authz, rate limit, body limit results.
4. **Deletion protection** — the three refused deletions with command output, snapshot/dump evidence.
5. **Open findings (accepted for staging)** — mapped to PRODUCTION-TODO numbers: mock payment provider trusts client outcome (#1 — CRITICAL for prod, accepted in staging by design), known-password demo customer account (#3 residual), no JWT revocation (#13), CloudFront→ALB origin hop is HTTP inside the VPC origin (#25 fixes with real domain + ACM), no CloudTrail/Config in scope, `connect-src https:` CSP looser than ideal, per-instance (not fleet-wide) app rate limiting.
6. **Verdict** — production-readiness deltas.

- [ ] **Step 5: Commit**

```bash
git add docs/verification/staging-security-audit.md
git commit -m "docs(security): staging security audit + deletion-protection demonstration"
```

### Task 16: Close the loop — tracker, docs, memory

**Files:**
- Modify: `PRODUCTION-TODO.md` (progress line + per-item annotations)
- Modify: `README.md` (deployment section pointer to infra/README.md)

- [ ] **Step 1: Update PRODUCTION-TODO.md**

Check off / annotate exactly what changed (keep the tracker's voice and format):
- #2 JWT boot validation → done (cherry-pick landed).
- #3 seed lockdown → done for staging (env-override password; note residual demo-customer cred).
- #5 rate limiting → done (app middleware + WAF edge rule; note per-instance scope).
- #9 security headers → done (API secureHeaders + CloudFront response-headers policies).
- #10 body limit → done. #14 → `/api/ready` + ALB checks done; note non-root/HEALTHCHECK Dockerfile items still open. #15 → advisory lock done. #16 → done for staging (DLM + pg_dump + CRR). #19 → done (noindex header). #6/#8 → done via CloudFront/build-guard (note Amplify path superseded by S3+CloudFront).
- #25/#26 → annotate: staging live on CloudFront domains via CloudFormation (S3+CloudFront supersedes the Amplify plan); prod domain/TLS still open.
- Update the `Progress: N/34 done.` line to match, and note the four staging URLs.

- [ ] **Step 2: README pointer**

Add a short "Deployment (staging)" subsection to `README.md` linking `infra/README.md` and the three verification docs.

- [ ] **Step 3: Commit**

```bash
git add PRODUCTION-TODO.md README.md
git commit -m "docs: mark staging-deployment tracker items done, link infra runbook"
```

---

## Execution notes for the orchestrator (not a task)

- Tasks 1→5 are sequential (same backend files). Tasks 6→11 are sequential (stack dependency order). Task 12 needs 6-11. Phase C/D strictly sequential after 12.
- Subagents get: the one task verbatim + Global Constraints. They commit but never push.
- Main agent between tasks: run the task's stated verification, spot-check the diff, keep a running cost eye (`NAT + ALB + 3×t3.small` ≈ $110/mo — flag anything that adds a resource type not in the spec).
- If a CloudFormation deploy fails: `troubleshoot_cloudformation_deployment` MCP tool first, then fix the template — never hand-edit resources in the console (drift breaks the "CloudFormation manages everything" requirement).
