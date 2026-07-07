# infra — AWS deployment

CloudFormation templates + a driver script for the fashion-studio staging/prod stacks.
Everything goes through `infra/deploy.sh <env> <command>` — avoid calling
`aws cloudformation` directly except for one-off debugging.

## Stack map + deploy order

Four stacks, deployed in this order (`cmd_stacks` in `deploy.sh`). The former `app`
and `edge` stacks were merged into a single `main` stack (2026-07-07 consolidation);
`infra/templates/main.yaml` is the source of truth — the old `app.yaml`/`edge.yaml`
templates have been removed:

1. **network** (ap-south-1) — VPC, subnets, security groups, and a self-managed
   NAT instance for private-subnet egress (see "Staging cost trims" below).
2. **data** (ap-south-1) — EC2 + Docker Postgres, EBS volume, DLM snapshots, backup
   bucket (in-region only — cross-region replication has been removed; see
   "Data-layer protection story" below). Publishes the Postgres host to
   `/fashion/<env>/db-host` in SSM Parameter Store, consumed by the `main` stack.
3. **waf** (us-east-1 — required for CloudFront WebACLs).
4. **main** (ap-south-1) — ALB, ASG, ECR repo, Secrets Manager (JWT + seed
   passwords), plus CloudFront + S3 for the SPAs and the API distribution. Takes
   `WafWebAclArn` from the `waf` stack. Two web distributions: storefront (also
   serves the socials SPA under `/qr-socials/` via a viewer-request CloudFront
   Function that rewrites the two entry paths to `qr-socials/index.html`) and
   admin. The socials app has no distribution or bucket of its own — its build
   is synced to the `qr-socials/` prefix of the storefront bucket.

Every `deploy_stack` call enables stack termination protection right after deploying,
so deleting a stack first needs `update-termination-protection --no-...`.

## Staging cost trims

Staging trades a little resilience for ~$60/mo of savings vs. the prod-shaped defaults:

- **Self-managed NAT instance (~$38/mo)** — private-subnet egress runs through a
  `t4g.nano` Amazon Linux 2023 EC2 instance (`NatInstance` in `network.yaml`) instead
  of a managed NAT Gateway. It has `SourceDestCheck: false` and its user-data enables
  IP forwarding plus an `iptables` MASQUERADE rule, so it forwards outbound traffic from
  the private subnets to the internet. `NatRecoveryAlarm` watches
  `StatusCheckFailed_System` and triggers EC2 auto-recovery — a dead NAT would sever SSM
  and all egress for every private instance, so this alarm matters. The trade-off is a
  single-AZ, single-instance SPOF with no throughput guarantees, which is fine for
  staging. **Prod can switch back to a managed NAT Gateway** by restoring the removed
  `NatEip` (`AWS::EC2::EIP`) and `Nat` (`AWS::EC2::NatGateway`) resources and pointing
  `PrivateDefaultRoute` back at `NatGatewayId: !Ref Nat` (the pre-trim configuration).
- **App ASG floor of 1 (~$16/mo)** — `APP_MIN=1` in `params/staging.env` (prod stays 2),
  so `DesiredCapacity` follows to 1. A `refresh` with `MinHealthyPercentage=50` may
  briefly leave 0 healthy targets — accepted for staging.
- **Basic (5-min) CloudWatch monitoring (~$6/mo)** — detailed 1-minute instance
  monitoring is off on both the data instance (`Monitoring: false` in `data.yaml`) and
  the app launch template (`Monitoring: { Enabled: false }` in `main.yaml`); prod can
  re-enable it. CloudWatch instance metrics land at 5-minute resolution instead of 1.

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
The admin QR generator's base URL is hardcoded to production
(`https://tanviagnihotry.com/qr-socials`), so staging builds never emit staging QRs.

## One-time migration: socials distro → /qr-socials path (2026-07-07)

The standalone socials bucket + distribution were removed from `main.yaml`; the
socials SPA now ships inside the storefront bucket under `qr-socials/`. Applying
this template update to an existing environment needs, in order:

1. Empty the old socials bucket first or the stack update fails on delete:
   `aws s3 rm s3://fashion-<env>-web-socials-<account-id> --recursive`
2. `infra/deploy.sh <env> stacks` — deletes the socials distro (CloudFront disable
   + delete takes ~10 min), adds the rewrite function to the storefront distro.
3. `infra/deploy.sh <env> cors` then `refresh` — drops the retired socials origin
   from `/fashion/<env>/cors-origins` (the page now calls the API from the
   storefront origin).
4. `infra/deploy.sh <env> spas` — publishes the socials build to the new prefix.
5. Reprint/replace any QR codes pointing at the old
   `https://<socials-dist>.cloudfront.net` URL — it is gone, not redirected.

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
