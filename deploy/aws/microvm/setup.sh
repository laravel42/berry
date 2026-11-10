#!/usr/bin/env bash
# One command from nothing to a Berry runtime image on AWS Lambda MicroVMs.
#
#   AWS_PROFILE=<account owner> ./deploy/aws/microvm/setup.sh            # us-east-1
#   REGION=eu-central-1 MEMORY_MIB=8192 ./deploy/aws/microvm/setup.sh
#
# 1. Deploys template.yaml (stack berry-microvm): artifact bucket, build and
#    execution roles, and an invoker IAM user whose key goes to Secrets Manager.
# 2. Packages the runtime image's Dockerfile (server-ts/sandbox/agentcore) and
#    the server-ts sources it copies into a zip, uploads it, and creates the
#    MicroVM image, or a new version of it on a later run. Lambda builds it.
# 3. Waits for the version to build, then writes the variables for Dokploy's
#    Environment tab to a 0600 file. The key is never printed.
#
# Needs: the AWS CLI v2 with `lambda-microvms`, git, python3.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ROOT="$(cd "$HERE/../../.." && pwd)"
REGION="${REGION:-us-east-1}"
STACK="${STACK:-berry-microvm}"
IMAGE_NAME="${IMAGE_NAME:-berry-runtime}"
MEMORY_MIB="${MEMORY_MIB:-4096}"
OUT="${OUT:-$HERE/microvm.env}"
USER_NAME="${USER_NAME:-berry-microvm-invoker}"
SECRET_NAME="${SECRET_NAME:-berry/microvm-invoker}"

for tool in aws git python3; do
   command -v "$tool" >/dev/null || { echo "Missing $tool" >&2; exit 1; }
done
aws lambda-microvms help >/dev/null 2>&1 || { echo "This AWS CLI has no lambda-microvms commands; update it." >&2; exit 1; }

ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
echo "== account $ACCOUNT, region $REGION"

BASE_IMAGE_ARN="$(aws lambda-microvms list-managed-microvm-images --region "$REGION" --query 'items[0].imageArn' --output text)"
[ -n "$BASE_IMAGE_ARN" ] && [ "$BASE_IMAGE_ARN" != "None" ] || { echo "Lambda MicroVMs has no base image in $REGION" >&2; exit 1; }
echo "== base image $BASE_IMAGE_ARN"

# The invoker key cannot be read back from an existing user or secret.
# The CLI's text output separates the ids with tabs; fold them to single spaces
# so owned() matches a whole id.
OWNED=" $(aws cloudformation list-stack-resources --region "$REGION" --stack-name "$STACK" \
   --query 'StackResourceSummaries[].LogicalResourceId' --output text 2>/dev/null \
   | tr -s '[:space:]' ' ' || true) "
owned() { [[ "$OWNED" == *" $1 "* ]]; }
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
   --parameter-overrides "InvokerUserName=$USER_NAME" "InvokerSecretName=$SECRET_NAME"; then
   echo "== why it failed" >&2
   aws cloudformation describe-events --region "$REGION" --stack-name "$STACK" --filters FailedEvents=true --output json >&2 || true
   exit 1
fi

output() {
   aws cloudformation describe-stacks --region "$REGION" --stack-name "$STACK" \
      --query "Stacks[0].Outputs[?OutputKey=='$1'].OutputValue" --output text
}
BUCKET="$(output ArtifactBucketName)"
BUILD_ROLE_ARN="$(output BuildRoleArn)"
EXECUTION_ROLE_ARN="$(output ExecutionRoleArn)"
SECRET_ARN="$(output InvokerSecretArn)"

WORK="$(mktemp -d)"
trap 'rm -rf "$WORK"' EXIT
TAG="$(git -C "$ROOT" rev-parse --short=12 HEAD)-$(date -u +%Y%m%d%H%M%S)"
ZIP="$WORK/code-artifact.zip"

echo "== packaging the runtime image"
# The AgentCore Dockerfile, made architecture-neutral: Lambda builds on its own
# hosts, so no stage is pinned to a platform and Bun picks the CPU it runs on.
# Every rewrite must match, so a changed Dockerfile fails here, not in AWS.
python3 - "$ROOT/server-ts" "$ZIP" <<'PY'
import subprocess, sys, zipfile
src, out = sys.argv[1], sys.argv[2]
dockerfile = open(f"{src}/sandbox/agentcore/Dockerfile").read()
rewrites = [
    ("FROM --platform=${BUILDPLATFORM} oven/bun:1.4.4-slim AS deps", "FROM oven/bun:1.4.4-slim AS deps"),
    ("FROM --platform=${BERRY_RUNTIME_PLATFORM} oven/bun:1.4.4-slim AS bun", "FROM oven/bun:1.4.4-slim AS bun"),
    ("FROM --platform=${BERRY_RUNTIME_PLATFORM} node:22-slim", "FROM node:22-slim"),
    ('   case "${BERRY_RUNTIME_PLATFORM}" in \\\n      linux/arm64*) cpu=arm64 ;; \\\n      linux/amd64) cpu=x64 ;; \\\n'
     '      *) echo "unsupported BERRY_RUNTIME_PLATFORM ${BERRY_RUNTIME_PLATFORM}" >&2; exit 1 ;; \\\n   esac; \\\n',
     '   case "$(uname -m)" in \\\n      aarch64) cpu=arm64 ;; \\\n      x86_64) cpu=x64 ;; \\\n'
     '      *) echo "unsupported machine $(uname -m)" >&2; exit 1 ;; \\\n   esac; \\\n'),
]
for old, new in rewrites:
    if old not in dockerfile and "AS bun" in old:
        continue  # that stage is optional
    if old not in dockerfile:
        sys.exit(f"the runtime Dockerfile changed; update setup.sh: missing {old.splitlines()[0]!r}")
    dockerfile = dockerfile.replace(old, new)
if "--platform=" in dockerfile:
    sys.exit("the runtime Dockerfile still pins a platform; update setup.sh")
# The working tree as git sees it: tracked and new files, nothing it ignores.
import os
listed = subprocess.run(["git", "-C", src, "ls-files", "-z", "--cached", "--others", "--exclude-standard"],
                        check=True, capture_output=True).stdout.decode().split("\0")
files = sorted({p for p in listed if p and p != "Dockerfile" and os.path.isfile(f"{src}/{p}")})
with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
    z.writestr("Dockerfile", dockerfile)
    for path in files:
        z.write(f"{src}/{path}", path)
print(f"{len(files)} files")
PY

KEY="microvm-images/$IMAGE_NAME/$TAG.zip"
aws s3 cp --region "$REGION" "$ZIP" "s3://$BUCKET/$KEY" --only-show-errors
echo "== uploaded s3://$BUCKET/$KEY"

# Static and not secret: they are part of the snapshot every VM starts from.
ENVIRONMENT="$(python3 -c 'import json,sys; print(json.dumps({"BERRY_RUNTIME_AUTH_MODE": "agentcore", "BERRY_AGENTCORE_REGION": sys.argv[1]}))' "$REGION")"
ARTIFACT="{\"uri\":\"s3://$BUCKET/$KEY\"}"
RESOURCES="[{\"minimumMemoryInMiB\":$MEMORY_MIB}]"
LOGGING="{\"cloudWatch\":{\"logGroup\":\"/aws/lambda-microvms/$IMAGE_NAME\"}}"

IMAGE_ARN="$(aws lambda-microvms list-microvm-images --region "$REGION" --name-filter "$IMAGE_NAME" \
   --query "items[?name=='$IMAGE_NAME'].imageArn | [0]" --output text)"
if [ -z "$IMAGE_ARN" ] || [ "$IMAGE_ARN" = "None" ]; then
   echo "== creating image $IMAGE_NAME"
   BEFORE=""
   IMAGE_ARN="$(aws lambda-microvms create-microvm-image --region "$REGION" \
      --name "$IMAGE_NAME" \
      --description "Berry agent runtime" \
      --base-image-arn "$BASE_IMAGE_ARN" \
      --build-role-arn "$BUILD_ROLE_ARN" \
      --code-artifact "$ARTIFACT" \
      --resources "$RESOURCES" \
      --environment-variables "$ENVIRONMENT" \
      --logging "$LOGGING" \
      --query imageArn --output text)"
else
   BEFORE="$(aws lambda-microvms get-microvm-image --region "$REGION" --image-identifier "$IMAGE_ARN" \
      --query latestActiveImageVersion --output text)"
   echo "== building a new version of $IMAGE_NAME (active: $BEFORE)"
   aws lambda-microvms update-microvm-image --region "$REGION" \
      --image-identifier "$IMAGE_ARN" \
      --base-image-arn "$BASE_IMAGE_ARN" \
      --build-role-arn "$BUILD_ROLE_ARN" \
      --code-artifact "$ARTIFACT" \
      --resources "$RESOURCES" \
      --environment-variables "$ENVIRONMENT" \
      --logging "$LOGGING" >/dev/null
fi
FAILED_BEFORE="$(aws lambda-microvms get-microvm-image --region "$REGION" --image-identifier "$IMAGE_ARN" \
   --query latestFailedImageVersion --output text)"

echo "== waiting for the build (this takes a while: the image is large)"
VERSION=""
for _ in $(seq 1 120); do
   read -r ACTIVE FAILED < <(aws lambda-microvms get-microvm-image --region "$REGION" --image-identifier "$IMAGE_ARN" \
      --query '[latestActiveImageVersion, latestFailedImageVersion]' --output text)
   if [ "$ACTIVE" != "None" ] && [ "$ACTIVE" != "$BEFORE" ]; then VERSION="$ACTIVE"; break; fi
   if [ "$FAILED" != "None" ] && [ "$FAILED" != "$FAILED_BEFORE" ]; then
      echo "Version $FAILED failed to build. Logs: /aws/lambda-microvms/$IMAGE_NAME in CloudWatch." >&2
      aws lambda-microvms list-microvm-image-builds --region "$REGION" --image-identifier "$IMAGE_ARN" --image-version "$FAILED" --output json >&2 || true
      exit 1
   fi
   sleep 30
done
[ -n "$VERSION" ] || { echo "Timed out waiting for the image build; it may still finish. Check get-microvm-image." >&2; exit 1; }

umask 077
{
   echo "# Paste into Dokploy's Environment tab, then delete this file."
   echo "BERRY_MICROVM_IMAGE_ARN=$IMAGE_ARN"
   echo "BERRY_MICROVM_IMAGE_VERSION=$VERSION"
   echo "BERRY_MICROVM_EXECUTION_ROLE_ARN=$EXECUTION_ROLE_ARN"
   echo "BERRY_MICROVM_REGION=$REGION"
   echo "BERRY_MICROVM_LOG_GROUP=/aws/lambda-microvms/$IMAGE_NAME"
   aws secretsmanager get-secret-value --region "$REGION" --secret-id "$SECRET_ARN" \
      --query SecretString --output text \
      | python3 -c 'import json,sys; [print(f"{k}={v}") for k,v in json.load(sys.stdin).items()]'
} > "$OUT"

echo
echo "Image: $IMAGE_ARN version $VERSION"
echo "Environment for Dokploy written to $OUT (mode 0600)."
echo "Leave BERRY_AGENTCORE_RUNTIME_ARN unset: it would take precedence."
