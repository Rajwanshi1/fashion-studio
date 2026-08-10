# infra — CloudFormation stacks + deploy driver

Read ./README.md FIRST (stack map, deploy order, restore runbook).
- Deploys are MANUAL via deploy.sh — NO CI; nothing deploys on merge.
- Production (tanviagnihotry.com) is the ONLY live environment — staging was
  fully torn down 2026-08-09.
- Data-stack changes can REPLACE the prod database (e.g. AMI/parameter drift) —
  read the restore runbook before touching it.
- Edge gotchas live here, not in app code: WAF caps request bodies at 8KB
  (image-naming presign exempted — PR #22); CSP headers are set only in CloudFront.
