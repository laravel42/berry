#!/usr/bin/env bash
# Deploys the agent runtime image to AWS Bedrock AgentCore Runtime (ADR-0014).
#
# Builds the ARM64 image from server-ts, pushes it to ECR and publishes a new
# runtime version pointing at it, with the environment the loop reads and the
# session lifecycle the ADR fixes. Needs credentials for the account that owns
# the runtime (AWS_PROFILE or the standard variables) with ECR push and
# bedrock-agentcore-control rights; the service user Berry runs with has
# neither, on purpose.
#
# Reads from ../../../.env (or $ENV_FILE): BERRY_BEDROCK_REGION,
# BERRY_MEDIA_VIDEO_S3_URI and, when RUNTIME_USES_STATIC_KEYS=1, the
# BERRY_BEDROCK_* key pair. Without static keys the runtime's execution role
# must be allowed to invoke Bedrock, Polly and the artifact bucket.
set -euo pipefail

HERE="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="${ENV_FILE:-$HERE/../../../.env}"
ACCOUNT="${ACCOUNT:?Set ACCOUNT to the AWS account ID}"
REGION="${REGION:-us-east-1}"
REPO="${REPO:-bedrock-agentcore-berry-sandbox}"
RUNTIME_ID="${RUNTIME_ID:-}"
RUNTIME_NAME="${RUNTIME_NAME:-berry_runtime}"
ROLE_ARN="${ROLE_ARN:?Set ROLE_ARN to the provisioned runtime execution role}"
TAG="${IMAGE_TAG:-$(git -C "$HERE" rev-parse --short=12 HEAD)-$(date -u +%Y%m%d%H%M%S)}"
IMAGE="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:$TAG"
[[ "$ACCOUNT" =~ ^[0-9]{12}$ ]] || { echo "Invalid ACCOUNT" >&2; exit 1; }
CALLER_ACCOUNT="$(aws sts get-caller-identity --query Account --output text)"
[ "$CALLER_ACCOUNT" = "$ACCOUNT" ] || { echo "AWS credentials belong to a different account" >&2; exit 1; }
if [ "${CREATE_ECR:-0}" = "1" ]; then
   aws ecr create-repository --region "$REGION" --repository-name "$REPO" --image-tag-mutability IMMUTABLE --image-scanning-configuration scanOnPush=true >/dev/null
fi
aws ecr describe-repositories --region "$REGION" --repository-names "$REPO" >/dev/null

NETWORK_CONFIGURATION="${NETWORK_CONFIGURATION:-}"
if [ -z "$NETWORK_CONFIGURATION" ]; then
   if [ -n "$RUNTIME_ID" ]; then
      NETWORK_CONFIGURATION="$(aws bedrock-agentcore-control get-agent-runtime --region "$REGION" --agent-runtime-id "$RUNTIME_ID" --query networkConfiguration --output json)"
   else
      NETWORK_CONFIGURATION='{"networkMode":"PUBLIC"}'
   fi
fi

echo "== building $IMAGE"
docker buildx build --platform linux/arm64 -f "$HERE/Dockerfile" -t "$IMAGE" --load "$HERE/../.."

echo "== pushing"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
docker push "$IMAGE"
DIGEST="$(aws ecr describe-images --region "$REGION" --repository-name "$REPO" --image-ids "imageTag=$TAG" --query 'imageDetails[0].imageDigest' --output text)"
[[ "$DIGEST" =~ ^sha256:[0-9a-f]{64}$ ]] || { echo "Missing image digest" >&2; exit 1; }
IMAGE="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO@$DIGEST"

echo "== publishing runtime version"
ENV_JSON="$(python3 - "$ENV_FILE" "${RUNTIME_USES_STATIC_KEYS:-0}" <<'PY'
import json, re, sys
env = {}
for line in open(sys.argv[1]):
    m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
    if m: env[m.group(1)] = m.group(2).strip('"')
out = {
    'BERRY_RUNTIME_AUTH_MODE': 'agentcore',
    'BERRY_BEDROCK_REGION': env.get('BERRY_BEDROCK_REGION') or 'us-east-1',
    'BERRY_MEDIA_VIDEO_S3_URI': env.get('BERRY_MEDIA_VIDEO_S3_URI', ''),
}
if sys.argv[2] == '1':
    out['BERRY_BEDROCK_ACCESS_KEY_ID'] = env['BERRY_BEDROCK_ACCESS_KEY_ID']
    out['BERRY_BEDROCK_SECRET_ACCESS_KEY'] = env['BERRY_BEDROCK_SECRET_ACCESS_KEY']
print(json.dumps({k: v for k, v in out.items() if v}))
PY
)"
if [ -n "$RUNTIME_ID" ]; then
   OPERATION=update-agent-runtime
   ID_ARGS=(--agent-runtime-id "$RUNTIME_ID")
else
   OPERATION=create-agent-runtime
   ID_ARGS=(--agent-runtime-name "$RUNTIME_NAME")
fi
RUNTIME_ID="$(aws bedrock-agentcore-control "$OPERATION" \
   --region "$REGION" "${ID_ARGS[@]}" \
   --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"$IMAGE\"}}" \
   --role-arn "$ROLE_ARN" \
   --network-configuration "$NETWORK_CONFIGURATION" \
   --protocol-configuration '{"serverProtocol":"HTTP"}' \
   --lifecycle-configuration '{"idleRuntimeSessionTimeout":3600,"maxLifetime":28800}' \
   --environment-variables "$ENV_JSON" \
   --query agentRuntimeId --output text)"
[ -n "$RUNTIME_ID" ] && [ "$RUNTIME_ID" != "None" ] || { echo "No runtime ID returned" >&2; exit 1; }

echo "== waiting for READY"
for _ in $(seq 1 60); do
   status="$(aws bedrock-agentcore-control get-agent-runtime --region "$REGION" --agent-runtime-id "$RUNTIME_ID" --query status --output text)"
   [ "$status" = "READY" ] && break
   case "$status" in CREATE_FAILED|UPDATE_FAILED|DELETE_FAILED|DELETED) echo "Runtime failed: $status" >&2; exit 1;; esac
   sleep 5
done
[ "$status" = "READY" ] || { echo "Timed out waiting for runtime $RUNTIME_ID ($status)" >&2; exit 1; }
echo "runtime $RUNTIME_ID is READY at $IMAGE"
echo
echo "Now point the API at it in .env:"
echo "  BERRY_AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:$REGION:$ACCOUNT:runtime/$RUNTIME_ID"
echo "and give the runtime a way back to Berry (BERRY_PUBLIC_URL, a tunnel locally)."
