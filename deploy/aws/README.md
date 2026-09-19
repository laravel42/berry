# Berry on AWS: one EC2 Docker host, with CDK

`cdk deploy` builds Berry's images, brings up the AWS resources and applies the release on the host. There is no separate release step.

```
browser ─ HTTPS ─ load balancer ─┬─ /api/*, /v1/*, *.preview.<domain> ─ api :4000 ─┐
                                 └─ everything else ─────────────────── web :3000  │ one EC2 host,
                                                                   postgres :5432  │ Docker Compose
                                              session router :8080 → one container per agent session
                                                        previews → the pull request's own containers
```

It is one host on purpose. A preview is the pull request's containers and an agent session is a container; the API starts both through the Docker socket of the machine it runs on and reaches them on its loopback. To take agent runs off the host, deploy the runtime to AgentCore (`server-ts/sandbox/agentcore/deploy.sh`) and put `BERRY_AGENTCORE_RUNTIME_ARN` in the application secret.

## What it creates

| | |
| --- | --- |
| Host | Amazon Linux 2023 on `t4g.xlarge` (4 vCPU, 16 GB, Graviton), 80 GB disk. No SSH and no inbound rule except the load balancer's; shell access is Session Manager. |
| Database | PostgreSQL 16 in a container, on its own encrypted 50 GB volume at `/data`. Snapshotted daily, seven kept. The volume is retained if the stack is deleted. |
| Address | An Application Load Balancer with one ACM certificate for `<domain>` and `*.preview.<domain>`, and both Route 53 records. Idle timeout 4000 s for the event stream. |
| Files | An S3 bucket for run artifacts, reached with the host's role. Retained. |
| Secrets | `AppEnv` in Secrets Manager: the API's environment as one JSON object. Retained. |
| Bedrock | An IAM user that can only invoke models, its key in Secrets Manager. Agent sessions get this key and not the host's role: the instance metadata hop limit is 1, so bridged containers (sessions, previews) cannot reach the role at all. |
| Images | `api`, `web`, agent `runtime` and `preview`, built by CDK for the host's processor and pushed to the bootstrap ECR repository. |

Rough cost in us-east-1, running all month: host about $98, load balancer about $18, disks and snapshots about $12, plus Bedrock usage.

## Before the first deploy

1. A Route 53 public hosted zone for your domain, in the same account.
2. Bedrock model access enabled in the Bedrock region (default `us-east-1`) for the models your agents use.
3. Docker running locally (the images are built on your machine), AWS credentials for the target account, Node 22.
4. Once per account and region: `npx cdk bootstrap`.

## Deploy

```bash
cd deploy/aws
npm install
npx cdk deploy -c domain=berry.example.com -c hostedZone=example.com
```

The first deploy takes about 15 minutes: certificate validation, image builds, then the host installing Docker and starting Berry. The first synth writes `cdk.context.json`, which pins the AMI, the zones and the hosted zone. Commit it: without the pin, a new Amazon Linux AMI would replace the host, and the host holds the database.

Then make sign-in work:

1. Create a GitHub OAuth App with callback `https://<domain>/api/auth/callback/github`.
2. Add its credentials to the secret named by the `AppSecretArn` output. Keep the generated keys that are already there:
   ```bash
   arn=<AppSecretArn>
   aws secretsmanager get-secret-value --secret-id "$arn" --query SecretString --output text \
     | jq '. + {BERRY_AUTH_GITHUB_CLIENT_ID: "…", BERRY_AUTH_GITHUB_CLIENT_SECRET: "…"}' > /tmp/berry-env.json
   aws secretsmanager put-secret-value --secret-id "$arn" --secret-string file:///tmp/berry-env.json && rm /tmp/berry-env.json
   ```
3. Apply it (see below).

Any variable the API reads (`.env.example` lists them) can be added to that secret the same way; a name set there wins over what the stack sets.

## Releases and changes

- **New code:** `npx cdk deploy …` again. Only images whose sources changed are rebuilt; the host pulls them and restarts those containers. Migrations run when the API starts. A release whose API does not answer `/ready` within three minutes fails the deploy and prints the API's last log lines.
- **Changed secret only:** re-run the release on the host:
  ```bash
  aws ssm start-associations-once --association-ids \
    "$(aws ssm list-associations --association-filter-list key=AssociationName,value=Berry-release --query 'Associations[0].AssociationId' --output text)"
  ```
- **Options** (all `-c name=value`): `instanceType` (default `t4g.xlarge`; an x86 type switches the image builds to amd64), `dataVolumeGiB` (50), `bedrockRegion` (`us-east-1`), `stackName` (`Berry`).

Changing `instanceType` stops and starts the host, a few minutes of downtime. `cdk diff` first, always: anything that says the `Host` or `Data` resource will be **replaced** must not be deployed without a plan for the data.

## Operating it

```bash
aws ssm start-session --target <HostId>        # a shell on the host
sudo docker compose -f /opt/berry/host/compose.yml ps
sudo docker compose -f /opt/berry/host/compose.yml logs -f api
sudo docker exec -it berry-postgres-1 psql -U berry berry
```

Restore: create a volume from a snapshot in the host's zone, stop the containers, swap it in at `/data`, start them.

The stack has termination protection. The data volume, the artifacts bucket and the application secret are retained when the stack is deleted, and the secret holds `INTEGRATION_ENCRYPTION_KEY`: without it, every stored GitHub credential and build variable is unreadable.

## Files

- `bin/berry.ts`, `lib/berry-stack.ts`: the CDK app.
- `docker/api.Dockerfile`: the API with the Docker client, for a host that runs previews and sessions. `docker/web.Dockerfile`: the Next.js standalone server. Both build from the repository root.
- `host/compose.yml`, `host/update.sh`: what runs on the host. `update.sh` is idempotent; the stack's State Manager association runs it with the release's settings.
