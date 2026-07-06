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
