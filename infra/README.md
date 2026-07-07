# infra — AWS deployment

CloudFormation templates + a driver script for the fashion-studio staging/prod stacks.
Everything goes through `infra/deploy.sh <env> <command>` — avoid calling
`aws cloudformation` directly except for one-off debugging.

## Stack map + deploy order

Four stacks, deployed in this order (`cmd_stacks` in `deploy.sh`). The former `app`
and `edge` stacks were merged into a single `main` stack (2026-07-07 consolidation);
`infra/templates/main.yaml` is the source of truth — the old `app.yaml`/`edge.yaml`
templates have been removed:

1. **network** (ap-south-1) — VPC, subnets, security groups.
2. **data** (ap-south-1) — EC2 + Docker Postgres, EBS volume, DLM snapshots, backup
   bucket (in-region only — cross-region replication has been removed; see
   "Data-layer protection story" below). Publishes the Postgres host to
   `/fashion/<env>/db-host` in SSM Parameter Store, consumed by the `main` stack.
3. **waf** (us-east-1 — required for CloudFront WebACLs).
4. **main** (ap-south-1) — ALB, ASG, ECR repo, Secrets Manager (JWT + seed
   passwords), plus CloudFront + S3 for the 3 SPAs and the API distribution. Takes
   `WafWebAclArn` from the `waf` stack.

Every `deploy_stack` call enables stack termination protection right after deploying,
so deleting a stack first needs `update-termination-protection --no-...`.

## One-command flows

```bash
infra/deploy.sh staging all       # stacks -> image -> cors -> refresh
infra/deploy.sh staging seed      # seed the DB over SSM (after refresh finishes)
infra/deploy.sh staging spas      # build + publish the 3 SPAs, invalidate CloudFront
infra/deploy.sh staging verify    # read-only: status + protection, all 4 stacks
```

`all` stops before `seed`/`spas`/`verify` — the instance refresh needs a few minutes to
land before those steps are useful. Each command also runs standalone.

Local e2e builds now fail loudly without `VITE_API_URL` (production Vite builds
require it, PRODUCTION-TODO #8) — export `VITE_API_URL=http://localhost:3001` before
`npm run build` locally. `cmd_spas` sets it to the staging API domain automatically.

## Secrets/params flow

- `infra/params/<env>.env` holds non-secret knobs (region, sizes, ASG bounds), `source`d
  by `deploy.sh`.
- Real secrets (DB password, JWT secret, seed passwords) live in Secrets Manager,
  created by the `data`/`main` templates — `deploy.sh` only reads them back, over SSM
  on the instance in `cmd_seed`, so values never transit the operator's machine.
- API image tag and CORS origins flow to instances via SSM Parameter Store
  (`/fashion/<env>/api-image-tag`, `/fashion/<env>/cors-origins`).

## Data-layer protection story

- **Termination protection** on the CloudFormation stack.
- **`DeletionPolicy`/`UpdateReplacePolicy: Retain`** on the EBS volume, DB secret, and
  backup bucket — survives stack delete/replace.
- **`DisableApiTermination: true`** on the data EC2 instance.
- **DLM** — EBS snapshots every 4 hours.
- **`pg_dump` to versioned in-region S3** — a cron job dumps Postgres to the backup
  bucket (versioned, AES256, 30-day lifecycle). Cross-region replication (CRR) has
  been removed to simplify the stack; backups are DLM snapshots + nightly `pg_dump`
  to the same-region bucket only.

## Restore runbook

1. Scale the `main` stack's ASG to 0 (or suspend processes) so nothing writes against
   a stale DB.
2. Recover data: restore a DLM snapshot to a new EBS volume and attach it to a new/
   replacement `data` instance, or (volume lost entirely) `pg_restore` the newest
   `pg_dump` from the backup bucket.
3. The `fashion-<env>-data-private-ip` export updates automatically on the `data`
   stack update — no manual consumer fix-up needed.
4. Restore `AppMin`/`AppMax`, run `infra/deploy.sh <env> refresh`, then `verify`.

## Prod checklist

- Use `infra/deploy.sh prod <command>` — this plan never runs it, staging only.
- Real domain + ACM cert (us-east-1) + origin TLS on the `main` stack's CloudFront
  distributions, replacing the raw `*.cloudfront.net` domains.
- Real Razorpay provider + production payment guard before taking payments live —
  PRODUCTION-TODO #1 (mock mode trusts a client-supplied outcome; never run it in prod).
- Re-run the full P0 list in PRODUCTION-TODO.md; staging deploys with payments mocked
  and a reduced app-hardening scope.
