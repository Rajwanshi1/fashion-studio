# Staging Resource Inventory

**Date:** 2026-07-06
**AWS account:** 741868637305 · **Primary region:** ap-south-1 · **Replica:** ap-southeast-1 · **WAF:** us-east-1

## URLs

| Surface | URL |
|---|---|
| Storefront | https://d1qn2j2hnhvlhl.cloudfront.net |
| Admin | https://d2n8mfypcal9h4.cloudfront.net |
| Socials | https://d36dldi1h3cvhl.cloudfront.net |
| API | https://d1d2imu6irdm96.cloudfront.net |

Source: `./infra/deploy.sh staging verify` (all stacks `*_COMPLETE`, termination protection enabled).

## fashion-staging-backup-replica (ap-southeast-1)

**Status:** `CREATE_COMPLETE` · **Termination protection:** `true`

| Logical ID | Type | Status |
|---|---|---|
| ReplicaBucket | AWS::S3::Bucket | CREATE_COMPLETE |

## fashion-staging-network (ap-south-1)

**Status:** `UPDATE_COMPLETE` · **Termination protection:** `true`

(`UPDATE_COMPLETE` reflects the ALB SG fix allowing the CloudFront origin-facing prefix list for the VPC origin — commit 761ccd9.)

| Logical ID | Type | Status |
|---|---|---|
| AlbSg | AWS::EC2::SecurityGroup | UPDATE_COMPLETE |
| AlbToAppEgress | AWS::EC2::SecurityGroupEgress | CREATE_COMPLETE |
| AppDnsTcpEgress | AWS::EC2::SecurityGroupEgress | CREATE_COMPLETE |
| AppDnsUdpEgress | AWS::EC2::SecurityGroupEgress | CREATE_COMPLETE |
| AppFromAlbIngress | AWS::EC2::SecurityGroupIngress | CREATE_COMPLETE |
| AppHttpsEgress | AWS::EC2::SecurityGroupEgress | CREATE_COMPLETE |
| AppNtpEgress | AWS::EC2::SecurityGroupEgress | CREATE_COMPLETE |
| AppSg | AWS::EC2::SecurityGroup | CREATE_COMPLETE |
| AppToDataEgress | AWS::EC2::SecurityGroupEgress | CREATE_COMPLETE |
| DataDnsTcpEgress | AWS::EC2::SecurityGroupEgress | CREATE_COMPLETE |
| DataDnsUdpEgress | AWS::EC2::SecurityGroupEgress | CREATE_COMPLETE |
| DataFromAppIngress | AWS::EC2::SecurityGroupIngress | CREATE_COMPLETE |
| DataHttpsEgress | AWS::EC2::SecurityGroupEgress | CREATE_COMPLETE |
| DataNtpEgress | AWS::EC2::SecurityGroupEgress | CREATE_COMPLETE |
| DataSg | AWS::EC2::SecurityGroup | CREATE_COMPLETE |
| Igw | AWS::EC2::InternetGateway | CREATE_COMPLETE |
| IgwAttach | AWS::EC2::VPCGatewayAttachment | CREATE_COMPLETE |
| Nat | AWS::EC2::NatGateway | CREATE_COMPLETE |
| NatEip | AWS::EC2::EIP | CREATE_COMPLETE |
| PrivateDefaultRoute | AWS::EC2::Route | CREATE_COMPLETE |
| PrivateRt | AWS::EC2::RouteTable | CREATE_COMPLETE |
| PrivateRtA | AWS::EC2::SubnetRouteTableAssociation | CREATE_COMPLETE |
| PrivateRtB | AWS::EC2::SubnetRouteTableAssociation | CREATE_COMPLETE |
| PrivateSubnetA | AWS::EC2::Subnet | CREATE_COMPLETE |
| PrivateSubnetB | AWS::EC2::Subnet | CREATE_COMPLETE |
| PublicDefaultRoute | AWS::EC2::Route | CREATE_COMPLETE |
| PublicRt | AWS::EC2::RouteTable | CREATE_COMPLETE |
| PublicRtA | AWS::EC2::SubnetRouteTableAssociation | CREATE_COMPLETE |
| PublicRtB | AWS::EC2::SubnetRouteTableAssociation | CREATE_COMPLETE |
| PublicSubnetA | AWS::EC2::Subnet | CREATE_COMPLETE |
| PublicSubnetB | AWS::EC2::Subnet | CREATE_COMPLETE |
| S3Endpoint | AWS::EC2::VPCEndpoint | CREATE_COMPLETE |
| Vpc | AWS::EC2::VPC | CREATE_COMPLETE |

## fashion-staging-data (ap-south-1)

**Status:** `CREATE_COMPLETE` · **Termination protection:** `true`

| Logical ID | Type | Status |
|---|---|---|
| BackupBucket | AWS::S3::Bucket | CREATE_COMPLETE |
| DataDiskAlarm | AWS::CloudWatch::Alarm | CREATE_COMPLETE |
| DataInstance | AWS::EC2::Instance | CREATE_COMPLETE |
| DataInstanceProfile | AWS::IAM::InstanceProfile | CREATE_COMPLETE |
| DataKmsAlias | AWS::KMS::Alias | CREATE_COMPLETE |
| DataKmsKey | AWS::KMS::Key | CREATE_COMPLETE |
| DataRole | AWS::IAM::Role | CREATE_COMPLETE |
| DataVolume | AWS::EC2::Volume | CREATE_COMPLETE |
| DataVolumeAttachment | AWS::EC2::VolumeAttachment | CREATE_COMPLETE |
| DbPasswordSecret | AWS::SecretsManager::Secret | CREATE_COMPLETE |
| DlmRole | AWS::IAM::Role | CREATE_COMPLETE |
| RecoveryAlarm | AWS::CloudWatch::Alarm | CREATE_COMPLETE |
| ReplicationRole | AWS::IAM::Role | CREATE_COMPLETE |
| SnapshotPolicy | AWS::DLM::LifecyclePolicy | CREATE_COMPLETE |

## fashion-staging-app (ap-south-1)

**Status:** `CREATE_COMPLETE` · **Termination protection:** `true`

| Logical ID | Type | Status |
|---|---|---|
| Alb | AWS::ElasticLoadBalancingV2::LoadBalancer | CREATE_COMPLETE |
| Alb5xxAlarm | AWS::CloudWatch::Alarm | CREATE_COMPLETE |
| ApiLogGroup | AWS::Logs::LogGroup | CREATE_COMPLETE |
| AppInstanceProfile | AWS::IAM::InstanceProfile | CREATE_COMPLETE |
| AppLaunchTemplate | AWS::EC2::LaunchTemplate | CREATE_COMPLETE |
| AppRole | AWS::IAM::Role | CREATE_COMPLETE |
| Asg | AWS::AutoScaling::AutoScalingGroup | CREATE_COMPLETE |
| CorsParam | AWS::SSM::Parameter | CREATE_COMPLETE |
| CpuScaling | AWS::AutoScaling::ScalingPolicy | CREATE_COMPLETE |
| EcrRepo | AWS::ECR::Repository | CREATE_COMPLETE |
| ImageTagParam | AWS::SSM::Parameter | CREATE_COMPLETE |
| JwtSecret | AWS::SecretsManager::Secret | CREATE_COMPLETE |
| Listener | AWS::ElasticLoadBalancingV2::Listener | CREATE_COMPLETE |
| SeedAdminSecret | AWS::SecretsManager::Secret | CREATE_COMPLETE |
| SeedCustomerSecret | AWS::SecretsManager::Secret | CREATE_COMPLETE |
| TargetGroup | AWS::ElasticLoadBalancingV2::TargetGroup | CREATE_COMPLETE |
| UnhealthyHostsAlarm | AWS::CloudWatch::Alarm | CREATE_COMPLETE |

## fashion-staging-waf (us-east-1)

**Status:** `CREATE_COMPLETE` · **Termination protection:** `true`

| Logical ID | Type | Status |
|---|---|---|
| WebAcl | AWS::WAFv2::WebACL | CREATE_COMPLETE |

## fashion-staging-edge (ap-south-1)

**Status:** `CREATE_COMPLETE` · **Termination protection:** `true`

| Logical ID | Type | Status |
|---|---|---|
| AdminBucket | AWS::S3::Bucket | CREATE_COMPLETE |
| AdminBucketPolicy | AWS::S3::BucketPolicy | CREATE_COMPLETE |
| AdminDist | AWS::CloudFront::Distribution | CREATE_COMPLETE |
| AdminHeadersPolicy | AWS::CloudFront::ResponseHeadersPolicy | CREATE_COMPLETE |
| ApiDist | AWS::CloudFront::Distribution | CREATE_COMPLETE |
| ApiVpcOrigin | AWS::CloudFront::VpcOrigin | CREATE_COMPLETE |
| Oac | AWS::CloudFront::OriginAccessControl | CREATE_COMPLETE |
| SocialsBucket | AWS::S3::Bucket | CREATE_COMPLETE |
| SocialsBucketPolicy | AWS::S3::BucketPolicy | CREATE_COMPLETE |
| SocialsDist | AWS::CloudFront::Distribution | CREATE_COMPLETE |
| SpaHeadersPolicy | AWS::CloudFront::ResponseHeadersPolicy | CREATE_COMPLETE |
| StorefrontBucket | AWS::S3::Bucket | CREATE_COMPLETE |
| StorefrontBucketPolicy | AWS::S3::BucketPolicy | CREATE_COMPLETE |
| StorefrontDist | AWS::CloudFront::Distribution | CREATE_COMPLETE |

## Deployment convergence record (2026-07-06)

- API image `741868637305.dkr.ecr.ap-south-1.amazonaws.com/fashion-studio-api:d71cfe3` built and pushed; `/fashion/staging/api-image-tag` = `d71cfe3`.
- CORS origins parameter set to the three SPA CloudFront URLs.
- Instance refresh `c21df0d4-53ae-4e3c-8d8a-20b6f0360008` completed `Successful`; both targets `healthy`.
- Seed via SSM: `status: Success`, output `Seeded catalog + users` (migrations applied at container boot).
- Smoke results: `/api/health` 200 `{"status":"ok"}` · `/api/ready` 200 `{"status":"ready"}` · `/api/products` 200 (16 seeded products) · storefront / admin / socials roots 200 · storefront deep link `/shop` 200.
