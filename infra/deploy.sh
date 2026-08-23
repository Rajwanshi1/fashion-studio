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

# The ACM cert (waf stack) can only DNS-validate after the registrar delegates
# the domain to the Route 53 zone. Fail fast with instructions instead of
# letting CloudFormation hang on CREATE_IN_PROGRESS for up to an hour.
require_delegation() {
  local zone_ns live_ns ns hit=0
  zone_ns=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-dns" NameServers)
  # Query a public resolver directly: the operator's local resolver can cache the
  # registrar's old NS for up to their TTL, long after the registry has the new
  # delegation (which is what ACM's resolvers see).
  live_ns=$(dig +short NS "$DOMAIN_NAME" @8.8.8.8 | sed 's/\.$//' | sort | tr '\n' ' ')
  for ns in ${zone_ns//,/ }; do
    case " $live_ns " in *" ${ns%.} "*) hit=1 ;; esac
  done
  if [ "$hit" -ne 1 ]; then
    echo ""
    echo "!! $DOMAIN_NAME is not yet delegated to the Route 53 hosted zone."
    echo "   At your registrar, replace the domain's nameservers with:"
    for ns in ${zone_ns//,/ }; do echo "     - ${ns%.}"; done
    echo "   Wait until 'dig +short NS $DOMAIN_NAME' shows them, then re-run:"
    echo "     infra/deploy.sh $ENV stacks"
    echo "   (network/data/dns are already deployed and will no-op on the re-run;"
    echo "    the cert-bearing waf stack and main are deferred until delegation.)"
    exit 1
  fi
  echo "NS delegation verified for $DOMAIN_NAME"
}

cmd_stacks() {
  deploy_stack "$PRIMARY_REGION" "fashion-$ENV_NAME-network" infra/templates/network.yaml \
    NatMode="$NAT_MODE"
  deploy_stack "$PRIMARY_REGION" "fashion-$ENV_NAME-data" infra/templates/data.yaml \
    DataInstanceType="$DATA_INSTANCE_TYPE" DetailedMonitoring="$DETAILED_MONITORING"
  local hosted_zone_id='' cert_arn=''
  if [ -n "$DOMAIN_NAME" ]; then
    deploy_stack "$PRIMARY_REGION" "fashion-$ENV_NAME-dns" infra/templates/dns.yaml \
      DomainName="$DOMAIN_NAME"
    hosted_zone_id=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-dns" HostedZoneId)
    require_delegation
  fi
  deploy_stack "$WAF_REGION" "fashion-$ENV_NAME-waf" infra/templates/waf.yaml \
    DomainName="$DOMAIN_NAME" HostedZoneId="$hosted_zone_id" AlertEmail="${ALERT_EMAIL:-}"
  local waf_arn media_cert_arn=''
  waf_arn=$(stack_out "$WAF_REGION" "fashion-$ENV_NAME-waf" WebAclArn)
  if [ -n "$DOMAIN_NAME" ]; then
    cert_arn=$(stack_out "$WAF_REGION" "fashion-$ENV_NAME-waf" CertificateArn)
    media_cert_arn=$(stack_out "$WAF_REGION" "fashion-$ENV_NAME-waf" MediaCertificateArn)
  fi
  # Presigned-upload CORS: the admin origin once a domain exists (mirrors
  # cmd_cors); '*' for domainless envs — the CloudFront admin domain is a main
  # stack output, unknowable before main's first deploy.
  local uploads_cors='*'
  if [ -n "$DOMAIN_NAME" ]; then uploads_cors="https://admin.$DOMAIN_NAME"; fi
  deploy_stack "$PRIMARY_REGION" "fashion-$ENV_NAME-main" infra/templates/main.yaml \
    AppInstanceType="$APP_INSTANCE_TYPE" AppMin="$APP_MIN" AppMax="$APP_MAX" WafWebAclArn="$waf_arn" \
    EcrRepoName="$ECR_REPO_NAME" DetailedMonitoring="$DETAILED_MONITORING" \
    PaymentProvider="$PAYMENT_PROVIDER" AllowMockPayments="$ALLOW_MOCK_PAYMENTS" \
    SmsProvider="${SMS_PROVIDER:-disabled}" AllowConsoleOtp="${ALLOW_CONSOLE_OTP:-false}" \
    UploadsCorsOrigins="$uploads_cors" AnthropicModel="${ANTHROPIC_MODEL:-claude-sonnet-5}" \
    DomainName="$DOMAIN_NAME" CertificateArn="$cert_arn" HostedZoneId="$hosted_zone_id" \
    AlertEmail="${ALERT_EMAIL:-}" MediaCertificateArn="$media_cert_arn" \
    KeepLegacyPublicRead="${KEEP_LEGACY_PUBLIC_READ:-true}"
}

cmd_image() {
  local ecr tag acct
  ecr=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-main" EcrUri)
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
  local iid data_ip cust_fetch cust_env
  iid=$(app_instance)
  # Resolved driver-side: the app instance role is deliberately least-privilege
  # (no cloudformation:* permissions), so it cannot call list-exports itself.
  data_ip=$(aws cloudformation list-exports --region "$PRIMARY_REGION" \
    --query "Exports[?Name=='fashion-$ENV_NAME-data-private-ip'].Value" --output text)
  # Prod seeds the admin only — no known-password demo customer.
  if [ "$SEED_DEMO_CUSTOMER" = "false" ]; then
    cust_fetch='"true",'
    cust_env='-e SEED_DEMO_CUSTOMER=false'
  else
    cust_fetch='"CUST_PW=$(aws secretsmanager get-secret-value --secret-id fashion/'"$ENV_NAME"'/seed-customer-password --region $REGION --query SecretString --output text)",'
    cust_env='-e SEED_CUSTOMER_PASSWORD=$CUST_PW'
  fi
  run_ssm "$iid" '[
    "REGION='"$PRIMARY_REGION"'",
    "ACCT=$(aws sts get-caller-identity --query Account --output text)",
    "REPO=$ACCT.dkr.ecr.$REGION.amazonaws.com/'"$ECR_REPO_NAME"'",
    "TAG=$(aws ssm get-parameter --name /fashion/'"$ENV_NAME"'/api-image-tag --region $REGION --query Parameter.Value --output text)",
    "DB_PW=$(aws secretsmanager get-secret-value --secret-id fashion/'"$ENV_NAME"'/db-password --region $REGION --query SecretString --output text)",
    "ADMIN_PW=$(aws secretsmanager get-secret-value --secret-id fashion/'"$ENV_NAME"'/seed-admin-password --region $REGION --query SecretString --output text)",
    '"$cust_fetch"'
    "docker run --rm -e DATABASE_URL=postgres://boutique:$DB_PW@'"$data_ip"':5432/boutique -e SEED_ADMIN_PASSWORD=$ADMIN_PW '"$cust_env"' $REPO:$TAG node dist/seed-cli.js"
  ]'
}

cmd_spas() {
  local api_url sf_domain sf_bucket sf_dist admin_bucket admin_dist
  if [ -n "$DOMAIN_NAME" ]; then
    api_url="https://api.$DOMAIN_NAME"
  else
    api_url="https://$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-main" ApiDomain)"
  fi
  sf_domain=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-main" StorefrontDomain)
  sf_bucket=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-main" StorefrontBucket)
  sf_dist=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-main" StorefrontDistId)
  admin_bucket=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-main" AdminBucket)
  admin_dist=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-main" AdminDistId)

  # Storefront owns the bucket root. The socials app lives under qr-socials/
  # in the SAME bucket (served at <storefront>/qr-socials/), so the storefront
  # sync must never --delete that prefix and the socials sync stays inside it.
  (cd frontend && rm -rf dist && VITE_API_URL="$api_url" npm run build)
  aws s3 sync frontend/dist "s3://$sf_bucket" --delete --exclude 'qr-socials/*' --region "$PRIMARY_REGION"
  (cd socials && rm -rf dist && VITE_API_URL="$api_url" npm run build)
  aws s3 sync socials/dist "s3://$sf_bucket/qr-socials" --delete --region "$PRIMARY_REGION"
  aws cloudfront create-invalidation --distribution-id "$sf_dist" --paths '/*' > /dev/null
  echo "published frontend + socials(/qr-socials) -> $sf_bucket"

  # Admin's QR generator always emits production URLs (hardcoded in
  # admin/src/pages/Socials.tsx) — printed QRs must survive any environment.
  # VITE_SHOP_URL is per-environment though: the product table links each piece
  # to the storefront this deploy just published, not to production.
  local shop_url
  if [ -n "$DOMAIN_NAME" ]; then
    shop_url="https://$DOMAIN_NAME"
  else
    shop_url="https://$sf_domain"
  fi
  (cd admin && rm -rf dist && VITE_API_URL="$api_url" VITE_SHOP_URL="$shop_url" npm run build)
  aws s3 sync admin/dist "s3://$admin_bucket" --delete --region "$PRIMARY_REGION"
  aws cloudfront create-invalidation --distribution-id "$admin_dist" --paths '/*' > /dev/null
  echo "published admin -> $admin_bucket"
}

cmd_cors() {
  # The socials page is served from the storefront origin (/qr-socials), so
  # only the storefront (+www) and admin origins are needed.
  local sf admin origins
  if [ -n "$DOMAIN_NAME" ]; then
    origins="https://$DOMAIN_NAME,https://www.$DOMAIN_NAME,https://admin.$DOMAIN_NAME"
  else
    sf=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-main" StorefrontDomain)
    admin=$(stack_out "$PRIMARY_REGION" "fashion-$ENV_NAME-main" AdminDomain)
    origins="https://$sf,https://$admin"
  fi
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
  local specs=("$PRIMARY_REGION:network" "$PRIMARY_REGION:data" \
               "$WAF_REGION:waf" "$PRIMARY_REGION:main")
  if [ -n "$DOMAIN_NAME" ]; then specs+=("$PRIMARY_REGION:dns"); fi
  for spec in "${specs[@]}"; do
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
