# Staging security audit + deletion-protection demonstration

## 1. Scope & method

- **Environment:** `fashion-staging` — AWS account `741868637305`, primary region `ap-south-1`, replica region `ap-southeast-1`, WAF/CloudFront in `us-east-1`.
- **When:** 2026-07-06, ~17:30–17:40 UTC. Auditor identity: IAM user `desktop-access`.
- **What was probed:**
  - **Infra (read-only):** instance public exposure + IMDS, security-group ingress, S3 public-access-block, EBS/volume encryption, IAM role policies (wildcard review), and a `cfn-guard` compliance scan of all six templates in `infra/templates/`.
  - **App (live, against `https://d1d2imu6irdm96.cloudfront.net`):** security headers, unauthenticated/customer-token authorization on admin routes, order-tracking IDOR (the `ce91303` fix), auth rate limiting, request body limit, and http→https redirects on all four CloudFront distributions.
  - **Deletion protection (expected-failure demonstration):** three destructive commands against the protected data layer, each expected — and confirmed — to be **refused**. No protection was ever disabled; every command failed and that failure is the evidence.
  - **Backups:** DLM snapshot presence + policy, and S3 nightly dump presence in both the primary and cross-region replica bucket (one dump triggered manually via SSM to verify the pipeline end-to-end).
- **Endpoints under audit:** API `d1d2imu6irdm96.cloudfront.net`; SPAs storefront `d1qn2j2hnhvlhl`, admin `d2n8mfypcal9h4`, socials `d36dldi1h3cvhl` (all `.cloudfront.net`).
- **Live resources:** data instance `i-004b5f6042f0c6b53`, pgdata volume `vol-0700b95ec53fdea51`, app instances `i-020131d6294cd54da` + `i-01edee4de444959a4` (ASG, min 2).

---

## 2. Infra findings

| # | Probe | Result | Verdict |
|---|-------|--------|---------|
| I-1 | Public IP on any instance | All instances `PublicIpAddress = null` (2 app + 1 data running; behind internal ALB / NAT) | **PASS** |
| I-2 | IMDS enforcement | `HttpTokens = required` (IMDSv2 enforced) on every instance | **PASS** |
| I-3 | Security-group ingress `0.0.0.0/0` | None. ALB SG ← tcp/80 from AWS-managed prefix list `pl-9aa247f3` (`com.amazonaws.global.cloudfront.origin-facing`); App SG ← tcp/3001 from ALB SG only; Data SG ← tcp/5432 from App SG only | **PASS** |
| I-4 | S3 public-access-block (all 5 buckets) | All four settings (`BlockPublicAcls`, `IgnorePublicAcls`, `BlockPublicPolicy`, `RestrictPublicBuckets`) = `true` on db-backup, web-storefront, web-admin, web-socials, and the ap-southeast-1 replica | **PASS** |
| I-5 | EBS encryption | pgdata `vol-0700b95ec53fdea51` encrypted (KMS CMK `alias/fashion-staging-data`, rotation enabled); both app root volumes and the data root volume encrypted | **PASS** |
| I-6 | IAM wildcard-action review | Policies are resource-scoped and least-privilege. The only `Resource: "*"` is `ecr:GetAuthorizationToken` in `app-instance` — this action is account-level and cannot be resource-scoped (standard AWS requirement). No wildcard **actions** anywhere; DLM/CloudWatch/SSM use AWS-managed service roles | **PASS (with expected ECR exception)** |

**Security-group topology (defence in depth):** CloudFront (VPC origin) → internal ALB (SG allows only the CloudFront origin-facing prefix list) → app instances (SG allows only ALB) → data instance (SG allows Postgres only from the app SG). No layer is reachable from the public internet at the network level.

### cfn-guard compliance scan (`check_cloudformation_template_compliance`, ruleset `aws-security`)

Findings are reported **verbatim**. For a staging audit these are documented, not fixed; each is triaged below. Templates are scanned from `infra/templates/`; the `edge.yaml` scan used one representative SPA S3 bucket (all three storefront/admin/socials buckets are configured identically) plus the API VPC-origin distribution.

| Template | Status | Violations (rule ids) | Triage |
|----------|--------|-----------------------|--------|
| `waf.yaml` | **COMPLIANT** | 0 | — |
| `network.yaml` | 4 | `EC2_SECURITY_GROUP_EGRESS_OPEN_TO_WORLD_RULE`, `NO_UNRESTRICTED_ROUTE_TO_IGW`, `SECURITY_GROUP_DESCRIPTION_RULE`, `SECURITY_GROUP_MISSING_EGRESS_RULE` | Egress-to-world = app/data instances need outbound 443 for ECR/Secrets/SSM (scoped to ports, not world-open ingress); IGW route is the required public-subnet default route for the NAT gateway; SG description/egress rule flags are cfn-guard shape checks (rules are defined as separate `SecurityGroupEgress` resources). **Accepted — by design.** |
| `data.yaml` | 5 | `S3_BUCKET_DEFAULT_LOCK_ENABLED`, `S3_BUCKET_LOGGING_ENABLED`, `S3_BUCKET_NO_PUBLIC_RW_ACL`, `EBS_OPTIMIZED_INSTANCE`, `IAM_NO_INLINE_POLICY_CHECK` | Backup bucket has BPA + SSE + versioning + cross-region replication + lifecycle; Object Lock / access logging are hardening deltas (see §5). `NO_PUBLIC_RW_ACL` is a false-positive shape check (BPA already blocks all public ACLs). `EBS_OPTIMIZED` is default-on for t3 (Nitro). Inline policies are the intentional least-privilege style. **Accepted.** |
| `backup-replica.yaml` | 4 | `S3_BUCKET_DEFAULT_LOCK_ENABLED`, `S3_BUCKET_LOGGING_ENABLED`, `S3_BUCKET_NO_PUBLIC_RW_ACL`, `S3_BUCKET_REPLICATION_ENABLED` | Replica is a replication **destination** (versioned, encrypted, BPA on); it does not itself replicate onward. Object Lock / access logging = hardening deltas. **Accepted.** |
| `app.yaml` | 2 | `IAM_NO_INLINE_POLICY_CHECK`, `IAM_POLICYDOCUMENT_NO_WILDCARD_RESOURCE` | Inline policy is the intentional least-privilege style. The only wildcard resource is `ecr:GetAuthorizationToken` (see I-6), which AWS requires to be `*`. **Accepted.** |
| `edge.yaml` | 6 | `S3_BUCKET_DEFAULT_LOCK_ENABLED`, `S3_BUCKET_LOGGING_ENABLED`, `S3_BUCKET_NO_PUBLIC_RW_ACL`, `S3_BUCKET_REPLICATION_ENABLED`, `S3_BUCKET_SSL_REQUESTS_ONLY`, `S3_BUCKET_VERSIONING_ENABLED` | SPA-asset buckets are private (BPA on, SSE-S3, OAC-only reads via a `SourceArn`-scoped bucket policy). Versioning / replication / Object Lock are not required for regenerable static assets. `S3_BUCKET_SSL_REQUESTS_ONLY` (no `aws:SecureTransport=false` deny) is a real low-severity delta — access is already CloudFront-over-TLS via OAC. **Accepted for staging; SSL-only deny is a cheap prod hardening.** |

Net: WAF compliant; all other findings are either cfn-guard shape/false-positive checks, by-design network routes, or the accepted staging/prod hardening deltas in §5. No live critical exposure surfaced by the scan.

---

## 3. App findings

| # | Probe | Result | Verdict |
|---|-------|--------|---------|
| A-1 | Security headers on `/api/health` | Present via Hono `secureHeaders`: `strict-transport-security: max-age=15552000; includeSubDomains`, `x-content-type-options: nosniff`, `x-frame-options: SAMEORIGIN`, `referrer-policy: no-referrer`, `cross-origin-opener-policy`, `cross-origin-resource-policy`, `x-xss-protection: 0`. SPA distros add a CSP + HSTS `max-age=63072000` + `x-frame-options: DENY` | **PASS** |
| A-2 | Unauthenticated → `GET /api/admin/products` | `401` | **PASS** |
| A-3 | Customer token → `GET /api/admin/products` | `403` (valid customer JWT rejected by admin RBAC; login via the seed-customer secret, credential not recorded here) | **PASS** |
| A-4 | IDOR on order tracking (`ce91303`) — `GET /api/orders/:orderNumber` | Correct `?email=` → `200`; **wrong** `?email=` → `404` with body `{"error":"Order not found"}` (identical to a missing order — no existence leak); no credential → `404` | **PASS** |
| A-5 | Auth rate limit — rapid `POST /api/auth/login` from one IP | 35 requests → no 429 (see note); 80 requests → **21× `429`** in the tail. App limit is `30/min/IP` on `/api/auth/*`, in-memory **per instance** | **PASS (per-instance; see §5)** |
| A-6 | Request body limit — 120 KB JSON to `/api/auth/login` | `403` — rejected at the **WAF edge** (`AWSManagedRulesCommonRuleSet` → `SizeRestrictions_BODY`, ~8 KB) before reaching the app's own `bodyLimit` (`100 KB` → `413`). Two layers; the edge fires first | **PASS (defence in depth)** |
| A-7 | http→https redirect on all 4 distributions | storefront / admin / socials / api each return `301` → `https://…` | **PASS** |

**A-5 note (why 35 requests showed no 429):** the app rate limiter keeps per-process in-memory buckets, and the ASG runs **2** app instances behind the ALB, so round-robin routing gives an *effective* ceiling of ~`60/min/IP` (2 × 30). 35 requests never crossed a single instance's bucket; 80 requests did (21 × 429). The fleet-wide backstop is the WAF `RateBasedStatement` at `2000/5min/IP`. This is the known "per-instance (not fleet-wide)" limitation mapped in §5.

---

## 4. Deletion protection (refused-deletion demonstration)

Three destructive commands were run **once each** against the protected data layer. **Every one was refused**, and the protections were confirmed still in place afterward. Nothing was disabled, forced, detached, or retried.

### Probe 1 — delete the protected CloudFormation stack
```
$ aws cloudformation delete-stack --stack-name fashion-staging-data --region ap-south-1

An error occurred (ValidationError) when calling the DeleteStack operation:
Stack [fashion-staging-data] cannot be deleted while TerminationProtection is enabled
```
Post-check: `describe-stacks` → `StackStatus = CREATE_COMPLETE`, `EnableTerminationProtection = true`. **REFUSED (synchronous ValidationError).**

### Probe 2 — terminate the data EC2 instance
```
$ aws ec2 terminate-instances --instance-ids i-004b5f6042f0c6b53 --region ap-south-1

An error occurred (OperationNotPermitted) when calling the TerminateInstances operation:
The instance 'i-004b5f6042f0c6b53' may not be terminated. Modify its 'disableApiTermination'
instance attribute and try again.
```
Post-check: instance `State = running`, `DisableApiTermination = true`. **REFUSED.**

### Probe 3 — delete the in-use pgdata EBS volume
```
$ aws ec2 delete-volume --volume-id vol-0700b95ec53fdea51 --region ap-south-1

An error occurred (VolumeInUse) when calling the DeleteVolume operation:
Volume vol-0700b95ec53fdea51 is currently attached to {i-004b5f6042f0c6b53}
```
Post-check: volume `State = in-use`, attachment `attached`. **REFUSED.**

**Result: 3/3 deletions refused; data layer fully intact.** Termination protection (stack), `DisableApiTermination` (instance), and volume attachment (plus `DeletionPolicy: Retain` / `UpdateReplacePolicy: Retain` on the stack, volume, instance, KMS key, and backup buckets) together make an accidental or malicious wipe of the data layer impossible without an explicit, deliberate un-protect step.

### Backup evidence
- **DLM EBS snapshots:** policy `policy-0403c8fae359f9d46` = `ENABLED`, "pgdata volume snapshots every 4h" (retain 42). One completed snapshot present: `snap-03ea3ab3c058bc1e5` (`completed`, `2026-07-06T14:28:30Z`). **PASS.**
- **S3 logical dumps (nightly `pg_dump`, cron `17 21 * * *` UTC):** the nightly window had not yet elapsed at audit time (~17:34 UTC), so `dumps/` was empty in both buckets — *first nightly window pending*, with the cron + `pg-backup.sh` on the data instance as evidence. To verify the pipeline end-to-end, one dump was triggered manually via SSM (`AWS-RunShellScript` → `/usr/local/bin/pg-backup.sh`):
  - Landed in the **primary** bucket: `s3://fashion-staging-db-backup-741868637305/dumps/boutique-20260706T173441Z.dump` (34001 bytes).
  - **Cross-region-replicated** to the **replica** bucket within ~5 s: `s3://fashion-staging-db-backup-replica-741868637305/dumps/boutique-20260706T173441Z.dump` (identical 34001 bytes, ap-southeast-1).
  - **PASS — backup + cross-region replication verified live.**

---

## 5. Open findings (accepted for staging)

Mapped to `PRODUCTION-TODO.md`. These are **accepted for the staging environment by design**; each is a real production gate.

| Finding | Tracker | Severity for prod | Notes |
|---------|---------|-------------------|-------|
| Mock payment provider trusts a client-supplied `outcome` — anyone can mark any order paid | **#1** | **CRITICAL** | Accepted in staging by design (no real money). Prod requires the real Razorpay provider + a boot guard refusing the mock when `NODE_ENV=production`. |
| Known-identity seed accounts (demo customer `aanya@example.com`, seed admin) | **#3** (residual) | HIGH | Passwords are randomly generated into Secrets Manager (not the repo literal), but the seed *identities* are known and `SEED_ON_START` is used in staging. Prod: `SEED_ON_START=false`, real admin with a unique password. |
| No JWT revocation — 7-day HS256 tokens, a demoted/disabled admin keeps access up to 7 days | **#13** | MEDIUM | Shorten expiry and/or add a revocation check on role-sensitive routes. |
| CloudFront → ALB origin hop is **HTTP** inside the VPC origin (`OriginProtocolPolicy: http-only`, port 80) | **#25** | MEDIUM | The hop is private (VPC-origin ENIs only, ALB SG restricted to the CloudFront prefix list) and viewer traffic is TLS end-to-end to CloudFront. Fixed by a real domain + ACM cert enabling HTTPS to the origin. |
| CSP `connect-src https:` is looser than ideal (any HTTPS host, not just the API origin) | #25-adjacent | LOW | Tighten to the specific API/allowed origins once the custom domain exists. |
| App rate limiting is **per-instance**, not fleet-wide (see A-5) | #5 (residual) | LOW | Effective ceiling scales with instance count; WAF `2000/5min/IP` is the fleet backstop. Prod: a shared store (Redis) or rely on the WAF rate rule. |
| No CloudTrail / AWS Config in scope | (not tracked) | MEDIUM | Add account-level CloudTrail + Config for audit/change tracking before prod. |
| S3 access logging, Object Lock, and `aws:SecureTransport=false` deny not set (cfn-guard) | (not tracked) | LOW | Cheap prod hardening for the backup + SPA buckets; not a live exposure (BPA + SSE + OAC/TLS already enforced). |

---

## 6. Verdict

**Staging security posture: strong.** Every network, encryption, public-access, authorization, IDOR, header, TLS, rate-limit, body-limit, and deletion-protection control probed behaves as designed.

- **Infra verdict:** PASS — no public instance exposure, IMDSv2 enforced, no `0.0.0.0/0` ingress, all buckets private with BPA, all volumes encrypted, IAM least-privilege, and the data layer is provably undeletable (3/3 destructive commands refused, backups present and cross-region-replicated).
- **App verdict:** PASS — admin RBAC (401 unauth / 403 customer), the `ce91303` order IDOR fix (wrong email → indistinguishable 404), auth rate limiting (429 under load), edge + app body-size limits, security headers, and http→https on all four distributions.

**Production-readiness deltas** (the gap between "secure staging" and "safe to take real customers/money"): **#1** (real payment provider + mock guard — critical), **#3** (production seed/credentials hygiene), **#13** (JWT lifecycle/revocation), **#25** (custom domain + ACM → HTTPS to origin and a tightened CSP), plus operational hardening not in staging scope — CloudTrail/Config, S3 access logging + SSL-only bucket policies, and a fleet-wide (shared-store) rate limiter. None of these is a live exposure in staging; each is an explicit gate for go-live.

---

## Addendum — 2026-07-07: 4-stack consolidation + URL rotation

The audit above (§1–6) reflects the environment as it existed on 2026-07-06, when
staging ran as six CloudFormation stacks including `backup-replica` (cross-region
`pg_dump` replication) and separate `app`/`edge` stacks. On 2026-07-07, staging was
consolidated to **four stacks — `network`/`data`/`main`/`waf`**: the `backup-replica`
stack and cross-region replication were removed (backups are now DLM snapshots +
in-region `pg_dump` only, per `infra/README.md`), and the former `app` and `edge`
stacks were merged into a single `main` stack. CloudFront distributions were
recreated as part of the merge, so **all four public URLs rotated**:

| Surface | Audited (2026-07-06, now dead) | Current (2026-07-07) |
| --- | --- | --- |
| Storefront | `d1qn2j2hnhvlhl.cloudfront.net` | `d3rb2k31ty2kox.cloudfront.net` |
| Admin | `d2n8mfypcal9h4.cloudfront.net` | `dr7ymafumqo0k.cloudfront.net` |
| Socials | `d36dldi1h3cvhl.cloudfront.net` | `d3byxnyud664li.cloudfront.net` |
| API | `d1d2imu6irdm96.cloudfront.net` | `d2bc3rl4v1olva.cloudfront.net` |

This addendum does not rewrite the original audit body above — it stands as the
historical record of the 2026-07-06 posture. What changed as a result of the
migration review:

- The data/network stacks (and the database + its seeded contents) were not
  modified by the migration; secret values (JWT secret, seed passwords) were
  captured and restored into the recreated `main` stack's secrets, so the
  authorization, IDOR, rate-limit, and RBAC behavior audited in §3 (A-1 through
  A-7) carries over unchanged — the `main` stack serves the same application image
  and security-header/CORS configuration as the former `app` stack.
- The **live probes were re-validated** against the new URLs as part of the
  migration review: `scripts/verify-api.sh` (39/39 passed) and the full Playwright
  suite (8/8 passed, zero retries) — see the "2026-07-07 re-run after 4-stack
  consolidation" section of `docs/verification/staging-e2e.md`. Both re-runs used
  the same live-network method as the original audit, exercising auth, RBAC,
  order-tracking IDOR protection, and payment flows end-to-end against the new
  `main`-stack API distribution — no regression observed.
- The deletion-protection demonstration in §4 and the backup evidence in §4/§97-102
  described the `data` stack, which was untouched by the consolidation; those
  findings still hold. The cross-region replication described there (§101,
  `backup-replica`) has since been removed by design (see `infra/README.md` §
  "Data-layer protection story") — this is a tracked simplification, not a
  regression, and is called out here rather than edited into the original §4 text.
- No new infra or app findings resulted from the consolidation; the accepted
  deltas in §5 (Open findings) are unchanged and still apply to the `main` stack.
