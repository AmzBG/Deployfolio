# Adopting the manually-created AWS environment

Pulumi does not automatically discover that console resources correspond to this program. If you run `pulumi up` before adoption, it will try to create a parallel environment. Export and back up the stack state before every import batch.

## Recommended choices

The safest path is usually greenfield: create a new Pulumi stack, restore/copy the database and S3 data, test it, switch DNS, and then remove the console environment. This gives a clean resource graph and a rollback path.

In-place adoption is possible when duplicate resources or migration downtime are unacceptable. It requires aligning the program's explicit names and settings with the console resources, importing every declared resource, and resolving the preview without replacements.

## In-place workflow

1. Record the AWS account, region, VPC/subnet/security-group IDs, RDS identifier, cache cluster ID, bucket name, CloudFront distribution/OAC IDs, ECR repository name, Amplify app/branch/domain IDs, ECS Express service ARN, IAM role names, secret ARN/version, and Route 53 zone.
2. Create and configure the Pulumi stack, including the current database password and existing application encryption/hash secrets. Changing `githubTokenEncryptionKey` makes stored GitHub access tokens unreadable.
3. Make the `name`, stack name, branch, database engine, domains, and other settings match the existing environment. If a console resource has a different immutable name, adjust the corresponding explicit name in the program before importing it.
4. Import parent resources before children. Examples below use placeholders and are not a copy/paste migration script.

```bash
pulumi import aws:ec2/vpc:Vpc vpc vpc-0123456789abcdef0
pulumi import aws:ec2/internetGateway:InternetGateway internet-gateway igw-0123456789abcdef0
pulumi import aws:ec2/subnet:Subnet public-subnet-1 subnet-aaaaaaaaaaaaaaaaa
pulumi import aws:ec2/subnet:Subnet public-subnet-2 subnet-bbbbbbbbbbbbbbbbb
pulumi import aws:ec2/routeTable:RouteTable public-route-table rtb-0123456789abcdef0

pulumi import aws:ec2/securityGroup:SecurityGroup api-security-group sg-aaaaaaaaaaaaaaaaa
pulumi import aws:ec2/securityGroup:SecurityGroup database-security-group sg-bbbbbbbbbbbbbbbbb
pulumi import aws:ec2/securityGroup:SecurityGroup cache-security-group sg-ccccccccccccccccc

pulumi import aws:rds/subnetGroup:SubnetGroup database-subnet-group EXISTING_DB_SUBNET_GROUP
pulumi import aws:rds/instance:Instance database EXISTING_RDS_IDENTIFIER
pulumi import aws:elasticache/subnetGroup:SubnetGroup cache-subnet-group EXISTING_CACHE_SUBNET_GROUP
pulumi import aws:elasticache/replicationGroup:ReplicationGroup cache EXISTING_REPLICATION_GROUP_ID

pulumi import aws:s3/bucket:Bucket media-bucket EXISTING_BUCKET_NAME
pulumi import aws:cloudfront/originAccessControl:OriginAccessControl media-origin-access-control EXISTING_OAC_ID
pulumi import aws:cloudfront/distribution:Distribution media-distribution EXISTING_DISTRIBUTION_ID
pulumi import aws:ecr/repository:Repository api-repository EXISTING_ECR_REPOSITORY_NAME

pulumi import aws:amplify/app:App frontend-app EXISTING_AMPLIFY_APP_ID
pulumi import aws:amplify/branch:Branch frontend-branch EXISTING_AMPLIFY_APP_ID/MAIN_BRANCH
pulumi import aws:amplify/domainAssociation:DomainAssociation frontend-domain EXISTING_AMPLIFY_APP_ID/example.com

pulumi import aws:iam/role:Role api-execution-role EXISTING_EXECUTION_ROLE_NAME
pulumi import aws:iam/role:Role api-task-role EXISTING_TASK_ROLE_NAME
pulumi import aws:iam/role:Role ecs-infrastructure-role EXISTING_INFRASTRUCTURE_ROLE_NAME
pulumi import aws:ecs/cluster:Cluster api-cluster EXISTING_CLUSTER_NAME
pulumi import aws:ecs/expressGatewayService:ExpressGatewayService api-service EXISTING_EXPRESS_SERVICE_ARN
```

Also import the route-table associations, S3 public-access/encryption/ownership/lifecycle resources, bucket policy, ECR lifecycle policy, IAM attachments/inline policies, log group, Secrets Manager secret/version, ACM validation resources, Route 53 records, and budget when those resources already exist. `pulumi preview --diff` identifies every still-unmanaged declaration.

ECS Express Mode is special: import the `ExpressGatewayService` resource, cluster, and the IAM/network resources supplied to it. Do not separately declare or import the ALB, target groups, listener, Express-managed security groups, deployment alarms, autoscaling policy, or Express certificate into this program. ECS owns those resources and modifying them independently can break Express updates.

## Replacement safety check

After each import batch:

```bash
pulumi refresh
pulumi preview --diff
pulumi stack export > pulumi-state-after-import.json
```

Do not apply a preview containing replacement or deletion of RDS, S3, CloudFront, Amplify, or ECS Express until the reason is understood. Common causes are a different VPC/subnet layout, immutable resource names, an ECS infrastructure role mismatch, public/private RDS mode, ECR tag mutability, or an Amplify repository connection created with the older GitHub OAuth mechanism.

Pulumi's import-generated suggestions are useful evidence, but keep the hand-written program as the target design. Reconcile properties deliberately instead of pasting generated code over it.
