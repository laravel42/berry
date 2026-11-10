#!/usr/bin/env bash
# One command from nothing to a Berry AgentCore Runtime.
#
#   AWS_PROFILE=<account owner> ./deploy/aws/agentcore/setup.sh            # us-east-1
#   REGION=eu-central-1 ./deploy/aws/agentcore/setup.sh
#
# 1. Deploys template.yaml (stack berry-agentcore): ECR repository, runtime
#    execution role, and an invoker IAM user whose key goes to Secrets Manager.
# 2. Builds the arm64 runtime image, pushes it and publishes the runtime
#    (server-ts/sandbox/agentcore/deploy.sh). Running it again publishes a new
#    version of the same runtime.
# 3. Prints the variables for Dokploy's Environment tab. The key is read from
#    Secrets Manager on this machine and written to a 0600 file, never printed.
#
# Needs: the AWS CLI v2 signed in to the account that will own the runtime,
# Docker with buildx able to build linux/arm64, git, python3.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
REGION="${REGION:-us-east-1}"
STACK="${STACK:-berry-agentcore}"
RUNTIME_NAME="${RUNTIME_NAME:-berry_runtime}"
OUT="${OUT:-$HERE/agentcore.env}"

for tool in aws docker git python3; do
   command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
done
docker buildx inspect --bootstrap >/dev/null 2>&1 || { echo "docker buildx is not usable" >&2; exit 1; }
if ! docker buildx inspect | grep -q 'linux/arm64'; then
   echo "The current buildx builder cannot build linux/arm64." >&2
   echo "Install QEMU binfmt (docker run --privileged --rm tonistiigi/binfmt --install arm64) or switch builder (docker buildx use <name>)." >&2
   exit 1
fi

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "== account $ACCOUNT, region $REGION"

REPO_NAME="${REPO_NAME:-bedrock-agentcore-berry-sandbox}"
USER_NAME="${USER_NAME:-berry-agentcore-invoker}"
SECRET_NAME="${SECRET_NAME:-berry/agentcore-invoker}"

# What this stack already owns, by logical id (empty on a first run).
OWNED="$(aws cloudformation list-stack-resources --region "$REGION" --stack-name "$STACK" \
   --query 'StackResourceSummaries[].LogicalResourceId' --output text 2>/dev/null || true)"
owned() { [[ " $OWNED " == *" $1 "* ]]; }

# A repository left by an earlier attempt is reused rather than recreated.
CREATE_REPOSITORY=true
if ! owned Repository && aws ecr describe-repositories --region "$REGION" --repository-names "$REPO_NAME" >/dev/null 2>&1; then
   echo "== reusing the existing ECR repository $REPO_NAME"
   CREATE_REPOSITORY=false
fi
# An IAM user or secret of the same name cannot be reused: its key is not ours to read.
if ! owned InvokerUser && aws iam get-user --user-name "$USER_NAME" >/dev/null 2>&1; then
   echo "IAM user $USER_NAME already exists outside this stack. Delete it, or run with USER_NAME=<another name>." >&2
   exit 1
fi
if ! owned InvokerSecret && aws secretsmanager describe-secret --region "$REGION" --secret-id "$SECRET_NAME" >/dev/null 2>&1; then
   echo "Secret $SECRET_NAME already exists outside this stack. Delete it, or run with SECRET_NAME=<another name>." >&2
   exit 1
fi

echo "== deploying stack $STACK"
if ! aws cloudformation deploy \
   --region "$REGION" \
   --stack-name "$STACK" \
   --template-file "$HERE/template.yaml" \
   --capabilities CAPABILITY_NAMED_IAM \
   --no-fail-on-empty-changeset \
   --parameter-overrides \
      "RepositoryName=$REPO_NAME" \
      "CreateRepository=$CREATE_REPOSITORY" \
      "InvokerUserName=$USER_NAME" \
      "InvokerSecretName=$SECRET_NAME"; then
   echo >&2
   echo "== why it failed" >&2
   aws cloudformation describe-events --region "$REGION" --stack-name "$STACK" --filters FailedEvents=true \
      --output json >&2 || true
   exit 1
fi

output() {
   aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
      --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
REPO="$(output RepositoryName)"
ROLE_ARN="$(output RuntimeExecutionRoleArn)"
SECRET_ARN="$(output InvokerSecretArn)"

# Publish a new version of the runtime when it already exists.
RUNTIME_ID="$(aws bedrock-agentcore-control list-agent-runtimes --region "$REGION" \
   --query "agentRuntimes[?agentRuntimeName=='$RUNTIME_NAME'].agentRuntimeId | [0]" --output text 2>/dev/null || true)"
[ "$RUNTIME_ID" = "None" ] && RUNTIME_ID=""

# deploy.sh reads only the region from its env file; do not hand it the repo's .env.
RUNTIME_ENV="$(mktemp)"
trap 'rm -f "$RUNTIME_ENV"' EXIT
printf 'BERRY_AGENTCORE_REGION=%s\n' "$REGION" > "$RUNTIME_ENV"

echo "== publishing the runtime ${RUNTIME_ID:-(new)}"
ACCOUNT="$ACCOUNT" REGION="$REGION" REPO="$REPO" ROLE_ARN="$ROLE_ARN" \
RUNTIME_ID="$RUNTIME_ID" RUNTIME_NAME="$RUNTIME_NAME" ENV_FILE="$RUNTIME_ENV" \
   "$ROOT/server-ts/sandbox/agentcore/deploy.sh"

RUNTIME_ID="$(aws bedrock-agentcore-control list-agent-runtimes --region "$REGION" \
   --query "agentRuntimes[?agentRuntimeName=='$RUNTIME_NAME'].agentRuntimeId | [0]" --output text)"
RUNTIME_ARN="arn:aws:bedrock-agentcore:$REGION:$ACCOUNT:runtime/$RUNTIME_ID"

umask 077
{
   echo "# Paste into Dokploy's Environment tab, then delete this file."
   echo "BERRY_AGENTCORE_RUNTIME_ARN=$RUNTIME_ARN"
   echo "BERRY_AGENTCORE_REGION=$REGION"
   aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET_ARN" \
      --query SecretString --output text \
      | python3 -c 'import json,sys; [print(f"{k}={v}") for k,v in json.load(sys.stdin).items()]'
} > "$OUT"

echo
echo "Runtime: $RUNTIME_ARN"
echo "Environment for Dokploy written to $OUT (mode 0600)."
echo "Paste it, deploy, check https://<your domain>/api/v1/config reports agentExecution: true, then delete the file."
