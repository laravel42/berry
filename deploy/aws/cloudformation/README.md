# Berry control plane on ECS Fargate

CloudFormation for the API and web app, in front of an **existing** Aurora or RDS
cluster that uses IAM database authentication. Customers never run `aws login`:
the Fargate **task role** mints `rds-db:connect` tokens.

This is not the EC2 Docker host in `deploy/aws`. Fargate has no Docker socket, so
it does not start preview apps or in-process agent-session containers. Agent runs
still need a connected subscription CLI (ADR-0019) and, if you use the AWS compute
host, `BERRY_AGENTCORE_RUNTIME_ARN`.

```
browser ─ ALB (idle 4000s) ─┬─ /api/*, /v1/*, /health, /ready ─ api :4000 ─┐
                            └─ everything else ────────────────── web :3000  │ one Fargate task
                                                                            │ Aurora IAM (task role)
                                                                            │ S3 artifacts
```

The task sits in public subnets (**ECS assigns the public IP**; subnets do not
auto-assign) and there is no NAT Gateway, so it can reach ECR, the ALB, and an
Aurora cluster that is not attached to this VPC (the same path a laptop uses
with IAM auth). The database instance stays not-publicly-accessible; do not
flip that flag.

## What it creates

| Resource | Notes |
| --- | --- |
| VPC, 2 public subnets, internet gateway | No NAT. ALB needs two AZs. |
| Application Load Balancer | Idle timeout 4000s for the event stream. HTTP :80; HTTPS :443 when you pass `CertificateArn`. |
| ECS cluster + Fargate service | One task: `api` and `web`. Desired count starts at **0**. |
| ECR repositories | `api` and `web`, scan on push. |
| S3 bucket | Run artifacts, encrypted, public access blocked, retained if the stack is deleted. |
| Secrets Manager `AppEnv` | Generated `BERRY_AUTH_SECRET`. Empty GitHub and integration keys until you edit them in the console. Retained. |
| Task role | `rds-db:connect` on your cluster user; S3 on the artifacts bucket; AgentCore actions only if you pass `AgentCoreRuntimeArn`. |
| Execution role | Pull images, write logs, read `AppEnv`. |

Current Fargate and ALB prices: [Fargate](https://aws.amazon.com/fargate/pricing/) and
[Elastic Load Balancing](https://aws.amazon.com/elasticloadbalancing/pricing/).
Aurora is assumed to already exist.

## Before the first deploy

1. Aurora/RDS with IAM database authentication. The database user (`postgres` by
   default) must have `GRANT rds_iam`. You need `DbClusterResourceId`
   (`aws rds describe-db-clusters --query 'DBClusters[].DbClusterResourceId'`).
2. `DATABASE_URL` **without a password**, e.g.
   `postgres://postgres@YOUR_CLUSTER.cluster-xxxx.us-east-1.rds.amazonaws.com:5432/postgres`.
3. Docker locally, to build and push images, and AWS credentials that can create
   the stack.
4. Optional: an ACM certificate in this region, plus a DNS name pointed at the
   ALB after create.

Do not put `DATABASE_SSL_REJECT_UNAUTHORIZED=false` in this stack. The Node
image already trusts the Amazon Root CAs.

## Deploy (do not skip DesiredCount=0)

From the repository root:

```bash
aws cloudformation deploy \
  --stack-name berry \
  --template-file deploy/aws/cloudformation/berry-fargate.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    DatabaseUrl='postgres://postgres@YOUR_CLUSTER.cluster-xxxx.us-east-1.rds.amazonaws.com:5432/postgres' \
    DbClusterResourceId=cluster-XXXXXXXX \
    DatabaseUser=postgres \
    CpuArchitecture=ARM64 \
    DesiredCount=0
```

`CpuArchitecture` must match the images (`ARM64` on Apple silicon,
`X86_64` on typical CI).

Copy the `ApiRepositoryUri` and `WebRepositoryUri` outputs, then build and push
(platform must match `CpuArchitecture`):

```bash
region=us-east-1
account=$(aws sts get-caller-identity --query Account --output text)
api_uri=<ApiRepositoryUri>
web_uri=<WebRepositoryUri>

aws ecr get-login-password --region "$region" \
  | docker login --username AWS --password-stdin "${account}.dkr.ecr.${region}.amazonaws.com"

docker build --platform linux/arm64 \
  -f server-ts/Dockerfile -t "${api_uri}:latest" server-ts
docker push "${api_uri}:latest"

docker build --platform linux/arm64 \
  --build-arg BERRY_API_ORIGIN=http://127.0.0.1:4000 \
  -f deploy/docker/web.Dockerfile -t "${web_uri}:latest" .
docker push "${web_uri}:latest"
```

Then start the service:

```bash
aws cloudformation deploy \
  --stack-name berry \
  --template-file deploy/aws/cloudformation/berry-fargate.yaml \
  --capabilities CAPABILITY_IAM \
  --parameter-overrides \
    DatabaseUrl='postgres://postgres@YOUR_CLUSTER.cluster-xxxx.us-east-1.rds.amazonaws.com:5432/postgres' \
    DbClusterResourceId=cluster-XXXXXXXX \
    DatabaseUser=postgres \
    CpuArchitecture=ARM64 \
    DesiredCount=1
```

The API container runs `src/migrate/index.ts up` before `src/index.ts`. The first
task waits up to three minutes for `/ready` (Aurora Serverless v2 resume plus
migrations).

## Sign-in and the integration key

Open the secret named by `AppEnvSecretArn` in the **Secrets Manager console**.
Keep `BERRY_AUTH_SECRET`. Set:

- `BERRY_AUTH_GITHUB_CLIENT_ID` / `BERRY_AUTH_GITHUB_CLIENT_SECRET` from a GitHub
  OAuth App whose callback is `https://<Url>/api/auth/callback/github`
- `INTEGRATION_ENCRYPTION_KEY` to the output of `openssl rand -base64 32`
  (32 bytes, base64). Empty leaves repository connections off; changing it later
  strands every sealed credential.

Do not change the `GenerateSecretString` block in the template after the secret
exists: CloudFormation would rewrite the JSON and drop those keys.

Then replace the running task so it reads the new values:

```bash
aws ecs update-service \
  --cluster berry-cluster \
  --service berry-control-plane \
  --force-new-deployment
```

(Use the `ClusterName` and `ServiceName` outputs.)

## HTTPS

Pass `CertificateArn` and `DomainName` on deploy. Point the domain at
`LoadBalancerDns`. HTTP on port 80 still forwards (the same target groups); add
an HTTP-to-HTTPS redirect on the listener if you want to refuse plaintext.

## Desktop

Packaged and `pnpm dev:desktop` windows should set `BERRY_DESKTOP_URL` to this
stack's `Url` instead of starting a local server. They do not need `DATABASE_URL`
or IAM variables when they are only a window onto the hosted API.

## Files

- `berry-fargate.yaml` — the template
- `parameters.example.json` — parameter names for `deploy --parameter-overrides`
