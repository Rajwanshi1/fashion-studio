# Media CDN — production runbook

Companion to the "Images: CDN + renditions + loading polish" PR. Code alone
changes nothing in prod: the templates are pure additions whose parameters
default to today's behaviour (`KeepLegacyPublicRead=true`, empty
`AlertEmail`/`MediaCertificateArn`), so the CDN goes live only through the
changesets below, **in order**. Deploys are manual; **never run
`infra/deploy.sh prod stacks`** — every stack change here goes through a
reviewed changeset. (`deploy.sh` does thread `ALERT_EMAIL` /
`KEEP_LEGACY_PUBLIC_READ` / the waf stack's media-cert output into `stacks`
for any future env — still keep `infra/params/prod.env` matching whatever the
executed changesets set, so an accidental run cannot revert them.)

Placeholders used throughout: `<account-id>` (AWS account), `<ops-email>`
(alert inbox), `<hosted-zone-id>` (from the `fashion-prod-dns` stack),
`<data-instance-id>` (step 5). The S3 base is
`https://fashion-prod-uploads-<account-id>.s3.ap-south-1.amazonaws.com`, the
media base `https://media.tanviagnihotry.com`.

## 1. waf changeset (us-east-1): media cert + scrape rule + alert topic

```bash
aws cloudformation create-change-set --region us-east-1 \
  --stack-name fashion-prod-waf --change-set-name media-cdn-waf \
  --template-body file://infra/templates/waf.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters ParameterKey=EnvName,UsePreviousValue=true \
               ParameterKey=DomainName,UsePreviousValue=true \
               ParameterKey=HostedZoneId,UsePreviousValue=true \
               ParameterKey=AlertEmail,ParameterValue=<ops-email>
aws cloudformation describe-change-set --region us-east-1 \
  --stack-name fashion-prod-waf --change-set-name media-cdn-waf \
  --query 'Changes[].ResourceChange.{action:Action,type:ResourceType,id:LogicalResourceId,replace:Replacement}' --output table
```

Review: expect **Add** MediaCertificate/AlertTopic/MediaScrapeAlarm and
**Modify** WebAcl (new media rule + a `/products/` carve-out on the existing
app-wide rate rule, `Replacement=False`). The existing `Certificate`
must NOT appear — if it does, stop.

Rate-limit note: `media-scrape-rate` starts at **3000/5min/IP** — an IP is a
carrier CGNAT pool (Jio/Airtel), not one shopper, so the budget covers ~4–6
concurrent heavy browsers while a catalogue scrape still trips it in under a
minute. After launch, tune against the media access logs + the
`fashion-prod-media-rate` metric. Fill `ALERT_EMAIL` in `infra/params/prod.env`
in the same change so the alarm actually mails someone (empty = silent). Then execute the changeset (console or
`execute-change-set`). The cert DNS-validates against the existing hosted
zone automatically; wait for ISSUED and note the ARN:

```bash
MEDIA_CERT_ARN=$(aws cloudformation describe-stacks --region us-east-1 \
  --stack-name fashion-prod-waf \
  --query "Stacks[0].Outputs[?OutputKey=='MediaCertificateArn'].OutputValue" --output text)
aws acm describe-certificate --region us-east-1 --certificate-arn "$MEDIA_CERT_ARN" \
  --query Certificate.Status   # wait for ISSUED before step 2
```

Also confirm the alarm's metric dimensions against a real datapoint once any
block has occurred (`aws cloudwatch list-metrics --namespace AWS/WAFV2
--region us-east-1`) — a dimension mismatch fails silently.

## 2. main changeset #1 (ap-south-1): MediaDist + alarms wiring

```bash
aws cloudformation create-change-set --region ap-south-1 \
  --stack-name fashion-prod-main --change-set-name media-cdn-main \
  --template-body file://infra/templates/main.yaml \
  --capabilities CAPABILITY_NAMED_IAM \
  --parameters ParameterKey=EnvName,UsePreviousValue=true \
               ParameterKey=AppInstanceType,UsePreviousValue=true \
               ParameterKey=AppMin,UsePreviousValue=true \
               ParameterKey=AppMax,UsePreviousValue=true \
               ParameterKey=WafWebAclArn,UsePreviousValue=true \
               ParameterKey=EcrRepoName,UsePreviousValue=true \
               ParameterKey=DetailedMonitoring,UsePreviousValue=true \
               ParameterKey=PaymentProvider,UsePreviousValue=true \
               ParameterKey=AllowMockPayments,UsePreviousValue=true \
               ParameterKey=SmsProvider,UsePreviousValue=true \
               ParameterKey=AllowConsoleOtp,UsePreviousValue=true \
               ParameterKey=WhatsAppProvider,UsePreviousValue=true \
               ParameterKey=AllowConsoleWhatsApp,UsePreviousValue=true \
               ParameterKey=UploadsCorsOrigins,UsePreviousValue=true \
               ParameterKey=AnthropicModel,UsePreviousValue=true \
               ParameterKey=DomainName,UsePreviousValue=true \
               ParameterKey=CertificateArn,UsePreviousValue=true \
               ParameterKey=HostedZoneId,UsePreviousValue=true \
               ParameterKey=AlertEmail,ParameterValue=<ops-email> \
               ParameterKey=MediaCertificateArn,ParameterValue=$MEDIA_CERT_ARN \
               ParameterKey=KeepLegacyPublicRead,ParameterValue=true
```

Review the changeset the same way. Expect **Add** MediaDist / MediaLogsBucket
/ AlertTopic / two DNS records, **Modify** UploadsBucket + UploadsBucketPolicy
+ both ALB alarms + AppLaunchTemplate (all `Replacement=False`). Execute; the
CloudFront distribution takes **~20 min**. The launch-template change
(MEDIA_BASE_URL) only reaches instances at the next refresh — step 4 does that.

Confirm **two** SNS subscription emails arrive at `<ops-email>` (one from the
us-east-1 WAF topic, one from ap-south-1) and click both confirm links.

## 3. Verify both read paths

```bash
# any existing key, e.g. from: psql> SELECT image_url FROM products WHERE image_url IS NOT NULL LIMIT 1;
curl -sI 'https://media.tanviagnihotry.com/products/<existing-key>' | head -3   # 200
curl -sI 'https://fashion-prod-uploads-<account-id>.s3.ap-south-1.amazonaws.com/products/<existing-key>' | head -3   # still 200
curl -sI 'https://media.tanviagnihotry.com/no-such-thing.jpg' | head -1          # 403/404, NOT 200 html
```

## 4. Deploy the app + SPAs

```bash
infra/deploy.sh prod image      # new API: MEDIA_BASE_URL wiring, presign renditions, migration 021
infra/deploy.sh prod refresh    # instances pick up the new launch template + image
# wait for the refresh to finish, then:
infra/deploy.sh prod spas       # storefront srcset/lazy + admin rendition uploads
```

After refresh: `curl -s https://api.tanviagnihotry.com/api/products?page=1&limit=1`
— `items[0].imageUrl` should already be a `media.` URL (read-time rewrite).

## 5. Renditions backfill (dry-run first)

The script lives in `backend/scripts/` (tsx + sharp, not in the API image), so
run it from a checkout with an SSM port-forward to prod Postgres; S3 access
comes from your local AWS credentials.

```bash
DATA_IID=$(aws cloudformation describe-stack-resources --region ap-south-1 \
  --stack-name fashion-prod-data \
  --query "StackResources[?ResourceType=='AWS::EC2::Instance'].PhysicalResourceId" --output text)
# terminal 1 — tunnel localhost:55432 → prod Postgres
aws ssm start-session --region ap-south-1 --target $DATA_IID \
  --document-name AWS-StartPortForwardingSession \
  --parameters portNumber=5432,localPortNumber=55432
# terminal 2 — from backend/
DB_PW=$(aws secretsmanager get-secret-value --secret-id fashion/prod/db-password \
  --region ap-south-1 --query SecretString --output text)
export DATABASE_URL="postgres://boutique:$DB_PW@127.0.0.1:55432/boutique"
export S3_UPLOADS_BUCKET=fashion-prod-uploads-<account-id> AWS_REGION=ap-south-1
export MEDIA_BASE_URL=https://media.tanviagnihotry.com
npm run backfill:image-renditions -- --dry-run   # read the plan
npm run backfill:image-renditions                # write
```

Idempotent — rerun freely; only rows with `width IS NULL` are touched.

## 6. One-time URL backfill (same tunnel, psql)

Readers already rewrite legacy URLs on the fly; this makes the stored data
match so step 8 can turn off public S3 reads. `psql "$DATABASE_URL"`:

```sql
\set s3base 'https://fashion-prod-uploads-<account-id>.s3.ap-south-1.amazonaws.com/'
\set mediabase 'https://media.tanviagnihotry.com/'
BEGIN;
UPDATE products      SET image_url = replace(image_url, :'s3base', :'mediabase') WHERE image_url  LIKE :'s3base' || '%';
UPDATE product_images SET url      = replace(url,       :'s3base', :'mediabase') WHERE url        LIKE :'s3base' || '%';
UPDATE order_items   SET image_url = replace(image_url, :'s3base', :'mediabase') WHERE image_url  LIKE :'s3base' || '%';
-- CMS blobs (hero/featured/lookbook images picked from the media library):
UPDATE site_content  SET value = replace(value::text, :'s3base', :'mediabase')::jsonb WHERE value::text LIKE '%' || :'s3base' || '%';
COMMIT;
-- verify nothing is left:
SELECT count(*) FROM products       WHERE image_url LIKE :'s3base' || '%';
SELECT count(*) FROM product_images WHERE url       LIKE :'s3base' || '%';
SELECT count(*) FROM order_items    WHERE image_url LIKE :'s3base' || '%';
SELECT count(*) FROM site_content   WHERE value::text LIKE '%' || :'s3base' || '%';
```

(If `site_content.value` is `json` rather than `jsonb`, cast with `::json`.)

## 7. Smoke

- Storefront: network tab on `/collection` and a PDP — every product image
  request hits `media.tanviagnihotry.com` only; cards show `srcset` on
  photos uploaded after the deploy; galleries only load the active slide ±1.
- Admin: upload a photo to a piece → gallery saves; the storefront PDP for it
  emits `srcset` (`_w320` … candidates) and responds with
  `cache-control: public,max-age=31536000,immutable`.
- An OLD order (admin → order detail, and the customer's account page):
  invoice thumbnails still render — these read `order_items.image_url`.

## 8. ≥24h later — main changeset #2: close public S3 reads

Only after step 6's counts are all 0 and a day of clean smoke. Same
create-change-set command as step 2 with every parameter
`UsePreviousValue=true` except:

```
ParameterKey=KeepLegacyPublicRead,ParameterValue=false
```

Expect **Modify** on UploadsBucket + UploadsBucketPolicy only. Execute, then:

```bash
curl -sI 'https://fashion-prod-uploads-<account-id>.s3.ap-south-1.amazonaws.com/products/<existing-key>' | head -1   # 403 now
curl -sI 'https://media.tanviagnihotry.com/products/<existing-key>' | head -1                                        # still 200
```

Roll back by flipping the parameter back to `true` — nothing else changes.

## 9. Data-disk alarm actions (CLI, parallel alarm)

The data stack's `DataDiskAlarm` has no actions, and data-stack changesets
are deliberately avoided (AMI/parameter drift can REPLACE the prod DB). Add a
parallel alarm pointing at the new topic instead:

```bash
TOPIC_ARN=$(aws sns list-topics --region ap-south-1 \
  --query "Topics[?ends_with(TopicArn,'fashion-prod-alerts')].TopicArn" --output text)
aws cloudwatch put-metric-alarm --region ap-south-1 \
  --alarm-name fashion-prod-data-disk-alerted \
  --alarm-description 'pgdata volume over 80 percent (alerted twin of the data stack alarm)' \
  --namespace Fashion/Data --metric-name disk_used_percent \
  --dimensions Name=InstanceId,Value=$DATA_IID Name=path,Value=/data Name=fstype,Value=xfs \
  --statistic Average --period 300 --evaluation-periods 1 --threshold 80 \
  --comparison-operator GreaterThanOrEqualToThreshold --treat-missing-data notBreaching \
  --alarm-actions $TOPIC_ARN --ok-actions $TOPIC_ARN
```

`$DATA_IID` from step 5. Verify it leaves INSUFFICIENT_DATA within ~10 min
(`aws cloudwatch describe-alarms --alarm-names fashion-prod-data-disk-alerted
--region ap-south-1 --query 'MetricAlarms[0].StateValue'`).
