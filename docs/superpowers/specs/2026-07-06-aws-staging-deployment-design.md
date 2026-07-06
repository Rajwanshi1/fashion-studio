# AWS Staging Deployment — Design

**Date:** 2026-07-06
**Status:** Approved by Sarthak (region, SPA hosting, data strategy, hardening scope, and full design each confirmed explicitly).
**Goal:** Deploy the platform to a production-grade AWS **staging** environment via CloudFormation, with segregated app/data layers on separate EC2 machines, hard data-deletion protection, capacity for 1000 concurrent users, then prove it: all resources live, all E2E tests green against the deployed apps, security audit written, deletion protection demonstrated.

## 0. Decisions (locked)

| Decision | Choice | Why |
|---|---|---|
| Region | `ap-south-1` (Mumbai) | India-based boutique + customers; nothing deployed yet so switching from CLI default (ap-southeast-1) is free |
| SPA hosting | S3 + CloudFront ×3 | 100% CloudFormation-managed, HTTPS without a domain, edge security headers, ~$2/mo; Amplify's GitHub connection can't be owned by CFN. `amplify.yml` stays but is unused |
| Data replication | Single data EC2 + EBS snapshots + replicated S3 dumps | DLM snapshots every 4h (7-day retention) + nightly pg_dump to versioned S3 with cross-region replication to ap-southeast-1. Live streaming replica deferred to prod |
| App hardening scope | Deploy-critical fixes only | Cherry-pick `wip/task1-boot-hardening`; add rate limiting, secureHeaders, bodyLimit, `/api/ready`, `SEED_ADMIN_PASSWORD` env, `VITE_API_URL` fail-loud. Payments stay mock in staging; audit maps the rest to PRODUCTION-TODO |
| Environments | staging now; prod as parameter file only; local untouched | One template set, per-env params |
| AWS account | 741868637305, IAM user `desktop-access` (AdministratorAccess) | Verified working |

## 1. Architecture

```
                        ┌─ CloudFront (storefront) ── S3 bucket (frontend dist)
Internet ── HTTPS ──────┼─ CloudFront (admin)      ── S3 bucket (admin dist)
                        ├─ CloudFront (socials)    ── S3 bucket (socials dist)
                        └─ CloudFront (api) ─ WAF ── ALB (internal, VPC origin)
                                                        │
                    VPC 10.20.0.0/16, 2 AZs             ▼
                    ┌────────────────────────────────────────────────┐
                    │ public subnets:  NAT Gateway (1)               │
                    │ private subnets: App ASG (t3.small ×2–4)       │
                    │                  └─ Docker: fashion-studio-api │
                    │                  Data EC2 (t3.small, protected)│
                    │                  └─ Docker: postgres:16-alpine │
                    │                     └─ separate encrypted EBS  │
                    └────────────────────────────────────────────────┘
Backups: DLM snapshot of data EBS every 4h (7-day retention)
       + nightly pg_dump → versioned S3 (SSE-KMS) → CRR to ap-southeast-1
```

- Four HTTPS entry points on default CloudFront domains (no custom domain in staging).
- The ALB is **internal**, reached via a CloudFront **VPC origin** — the API has zero public surface besides CloudFront. Fallback if VPC origins hit a regional/CFN snag: internet-facing ALB restricted to the CloudFront managed prefix list + `X-Origin-Verify` shared-secret header rule; the deploy notes must record which path was used.
- No instance has a public IP. Access is SSM Session Manager only: no SSH keys, no port 22, no bastion.

## 2. CloudFormation organization

Four independent stacks wired by exports, deployed in order:

1. **`fashion-<env>-network`** — VPC, 2 public + 2 private subnets across 2 AZs, IGW, 1 NAT Gateway, route tables, S3 gateway endpoint, shared SGs skeleton.
2. **`fashion-<env>-data`** — data EC2 + separate gp3 EBS data volume + KMS key + primary backup S3 bucket with CRR configuration + DLM lifecycle + IAM roles + CloudWatch alarms. *Deployed once, then never touched by app deploys.* The CRR **destination** bucket lives in a tiny fifth stack, `fashion-<env>-backup-replica`, deployed to ap-southeast-1 first (CloudFormation is region-scoped; a Mumbai stack cannot create a Singapore bucket).
3. **`fashion-<env>-app`** — ECR repo, Launch Template, ASG (min 2 / max 4, target-tracking CPU 60%), internal ALB, target group (health check `/api/ready`), instance profile, Secrets Manager secrets, SSM params, log groups, alarms.
4. **`fashion-<env>-edge`** — 3× (S3 bucket + OAC + CloudFront distro + response-headers policy) for the SPAs, 1× CloudFront distro for the API (VPC origin → ALB) with WAF WebACL (AWS managed common rule set + rate-based rule).

Rejected alternatives: single template (data lifecycle tangled with app churn), nested stacks (parent delete cascades — exactly the accident being defended against).

Naming: `fashion-{staging|prod}-{network|data|app|edge}`. Everything parameterized by `EnvName`; `infra/params/staging.json` deployed now, `infra/params/prod.json` written but not deployed.

## 3. Data layer protection

- Dedicated EC2 runs `postgres:16-alpine` in Docker (mirrors local), `PGDATA` on a **separate encrypted gp3 EBS volume** mounted at `/data`; root volume holds nothing precious. `DeleteOnTermination: false`.
- **Deletion defenses, layered** (each verified by attempting the deletion in the audit):
  1. Stack termination protection ON for all four stacks (mandatory for `data`).
  2. `DeletionPolicy: Retain` + `UpdateReplacePolicy: Retain` on the data instance, EBS volume, backup buckets, KMS key.
  3. `DisableApiTermination: true` on the data instance.
- **Backups:** DLM policy — snapshot the data volume every 4 hours, retain 7 days. Nightly cron on the data instance: `pg_dump -Fc` → versioned S3 bucket (SSE-KMS, Block Public Access) with **cross-region replication** to ap-southeast-1; lifecycle expires dumps at 30 days (primary) / 90 days (replica).
- **Recovery/health:** CloudWatch auto-recover alarm on StatusCheckFailed_System; disk-usage alarm on `/data` via CloudWatch agent.
- Postgres reachable only from the app SG on 5432. Not from the internet, not from the ALB.

## 4. App layer & scalability (1000 concurrent users)

- ASG min 2 / max 4 × t3.small across both AZs, target-tracking CPU 60%. 1000 concurrent shoppers ≈ 100–300 req/s; 2 instances of the Hono/pg API cover it — the ASG is headroom plus AZ-failure tolerance.
- User data: install Docker + CloudWatch agent, `docker login` to ECR, pull `fashion-studio-api:<tag>`, run with env drawn from SSM Parameter Store / Secrets Manager at boot (secrets never appear in template or user-data plaintext; use dynamic references / runtime `aws secretsmanager get-secret-value`).
- Migration safety with >1 replica (tracker #15): ASG rolling replacement means brief overlap; mitigate by running migrations before instance refresh via SSM Run Command on one instance (deploy script step), not on every boot. `SEED_ON_START=false` in staging.
- Container logs via awslogs driver → CloudWatch Logs (30-day retention). Alarms: ALB 5xx rate, UnHealthyHostCount, ASG CPU.

## 5. Security

- **Edge:** WAF on the API distro (managed common rules + rate-based rule ~2000 req/5min/IP). CloudFront response-headers policies give every SPA HSTS, CSP, X-Frame-Options DENY, nosniff, Referrer-Policy (tracker #9 at the edge); admin distro adds `X-Robots-Tag: noindex` (#19). S3 origins locked with OAC; Block Public Access on all buckets.
- **Network:** SG chain CloudFront→ALB(:80 internal)→app(:3001)→data(:5432); IMDSv2 required (`HttpTokens: required`); no public IPs; egress restricted to what's needed (443 out for ECR/SSM/S3 via NAT + S3 endpoint).
- **Secrets:** Secrets Manager generates DB password, JWT secret (≥48 chars), staging admin password. Instance profiles get least-privilege read on exactly those ARNs + ECR pull + CloudWatch write + SSM core.
- **App code (deploy-critical only):**
  - Cherry-pick `4dd6594` (`wip/task1-boot-hardening`): JWT_SECRET mandatory/validated at boot + refuse seeding when `NODE_ENV=production` (tracker #2, part of #3).
  - Per-IP rate limiting: strict on `/api/auth/*`, generous global (tracker #5).
  - `secureHeaders` + `bodyLimit` on the API (#9 API-side, #10).
  - `/api/ready` endpoint that pings the pool — ALB health check target (#14, endpoint only).
  - Seed admin password overridable via `SEED_ADMIN_PASSWORD` env; staging seeds with the generated secret, never the committed `TanviAdmin@2026` (#3).
  - `VITE_API_URL` fail-loud in production SPA builds (#8).
- **Out of scope (documented as open findings in the audit, mapped to tracker numbers):** real Razorpay provider (#1 — staging intentionally runs the mock; `PAYMENT_PROVIDER` gate lands with #1), JWT revocation (#13), CI (#20), transactional email (#22), custom domain + end-to-end origin TLS (#25).

## 6. Environments

- One template set + per-env parameter files. Staging: `NODE_ENV=production`, `SEED_ON_START=false`; demo data loaded once via SSM Run Command invoking a standalone seed runner with the staging-unique admin password. The cherry-picked guard blocks the *boot-path* seed under `NODE_ENV=production`; the standalone runner is a deliberate operator action and runs the seed module directly (with an explicit override env if the guard also covers direct invocation). Local env untouched.
- `CORS_ORIGINS` lives in an SSM param read at container start; the deploy script updates it with the actual CloudFront domains after the edge stack exists, then bounces containers (chicken-and-egg between app and edge stacks resolved by param + restart, not stack update).

## 7. Deployment flow

`infra/deploy.sh <env>`:
1. Validate all templates (cfn-lint + cfn-guard via AWS IaC tooling).
2. Deploy/update stacks in order (network → data → app → edge), `--enable-termination-protection` on create.
3. Build + push API image to ECR (tag = git SHA).
4. Run DB migrations via SSM Run Command (single instance).
5. Build 3 SPAs with staging `VITE_API_URL` (the API CloudFront domain); `aws s3 sync` + CloudFront invalidation.
6. Update `CORS_ORIGINS` SSM param with the three SPA CloudFront domains; rolling instance refresh.

## 8. Verification (evaluation criteria, mapped)

1. **All resources on AWS** — script lists every stack's resources in `CREATE_COMPLETE`/`UPDATE_COMPLETE`; output saved to `docs/verification/staging-resources.md`.
2. **E2E on the deployed apps** — parameterize Playwright (`E2E_BASE_URL`, `E2E_ADMIN_URL`, `E2E_API_URL` envs, defaulting to current localhost values) and run all 8 specs (desktop + mobile projects) against the CloudFront URLs; also run `scripts/verify-api.sh` (parameterized base URL) against the live API. **All must pass**; results saved to `docs/verification/staging-e2e.md`.
3. **Security audit** — infra (SG exposure scan, public-S3 scan, IAM wildcard review, encryption coverage, IMDSv2, cfn-guard compliance report) + app (headers, TLS grades, authz probes: non-admin hitting admin routes, IDOR attempts on orders, rate-limit behavior) → `docs/verification/staging-security-audit.md` with open items mapped to PRODUCTION-TODO numbers.
4. **Deletion protection demonstrated** — attempt `delete-stack` on `fashion-staging-data` (expect termination-protection refusal), attempt `terminate-instances` on the data EC2 (expect `DisableApiTermination` refusal), attempt volume delete while attached (expect `VolumeInUse`); command outputs recorded in the audit doc.

## 9. Cost (staging, monthly, ap-south-1 ballpark)

EC2 3× t3.small ~$37 · ALB ~$19 · NAT Gateway ~$36 · WAF ~$8 · EBS + snapshots ~$6 · Secrets Manager/CloudFront/S3 ~$4 ≈ **$110/mo**. NAT Gateway is the price of fully-private instances. Trim levers if wanted later: ASG min 1 (−$12), drop WAF (−$8).

## 10. Error handling & failure modes

- Stack create/update failure → rollback is automatic except data stack (Retain policies keep resources); `troubleshoot_cloudformation_deployment` tooling for diagnosis; deploy script stops at first failed stack.
- App instance unhealthy → ALB pulls it, ASG replaces it; deploys are `docker run` idempotent via user data + instance refresh.
- Data instance failure → CloudWatch auto-recover (same volume reattaches); worst case restore = new instance from template + attach volume or restore latest snapshot (runbook section in audit doc).
- E2E flakes against real network: Playwright retries already configured (retries: 1); failures block sign-off.
