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
ACCOUNT="${ACCOUNT:-333976512094}"
REGION="${REGION:-us-east-1}"
REPO="${REPO:-bedrock-agentcore-berry-sandbox}"
RUNTIME_ID="${RUNTIME_ID:-berry_sandbox-WM18a73lI3}"
ROLE_ARN="${ROLE_ARN:-arn:aws:iam::$ACCOUNT:role/BerryAgentCoreSandboxExecutionRole}"
IMAGE="$ACCOUNT.dkr.ecr.$REGION.amazonaws.com/$REPO:latest"

value() { grep -E "^$1=" "$ENV_FILE" | head -1 | cut -d= -f2- | tr -d '"'; }

echo "== building $IMAGE"
docker buildx build --platform linux/arm64 -f "$HERE/Dockerfile" -t "$IMAGE" --load "$HERE/../.."

echo "== pushing"
aws ecr get-login-password --region "$REGION" | docker login --username AWS --password-stdin "$ACCOUNT.dkr.ecr.$REGION.amazonaws.com"
docker push "$IMAGE"

echo "== publishing runtime version"
ENV_JSON="$(python3 - "$ENV_FILE" "${RUNTIME_USES_STATIC_KEYS:-0}" <<'PY'
import json, re, sys
env = {}
for line in open(sys.argv[1]):
    m = re.match(r'^([A-Z0-9_]+)=(.*)$', line.strip())
    if m: env[m.group(1)] = m.group(2).strip('"')
out = {
    'BERRY_BEDROCK_REGION': env.get('BERRY_BEDROCK_REGION') or 'us-east-1',
    'BERRY_MEDIA_VIDEO_S3_URI': env.get('BERRY_MEDIA_VIDEO_S3_URI', ''),
}
if sys.argv[2] == '1':
    out['BERRY_BEDROCK_ACCESS_KEY_ID'] = env['BERRY_BEDROCK_ACCESS_KEY_ID']
    out['BERRY_BEDROCK_SECRET_ACCESS_KEY'] = env['BERRY_BEDROCK_SECRET_ACCESS_KEY']
print(json.dumps({k: v for k, v in out.items() if v}))
PY
)"
aws bedrock-agentcore-control update-agent-runtime \
   --region "$REGION" \
   --agent-runtime-id "$RUNTIME_ID" \
   --agent-runtime-artifact "{\"containerConfiguration\":{\"containerUri\":\"$IMAGE\"}}" \
   --role-arn "$ROLE_ARN" \
   --network-configuration '{"networkMode":"PUBLIC"}' \
   --protocol-configuration '{"serverProtocol":"HTTP"}' \
   --lifecycle-configuration '{"idleRuntimeSessionTimeout":3600,"maxLifetime":28800}' \
   --environment-variables "$ENV_JSON" \
   --query '{version:agentRuntimeVersion,status:status}' --output json

echo "== waiting for READY"
for _ in $(seq 1 60); do
   status="$(aws bedrock-agentcore-control get-agent-runtime --region "$REGION" --agent-runtime-id "$RUNTIME_ID" --query status --output text)"
   [ "$status" = "READY" ] && break
   sleep 5
done
echo "runtime $RUNTIME_ID is $status"
echo
echo "Now point the API at it in .env:"
echo "  BERRY_AGENTCORE_RUNTIME_ARN=arn:aws:bedrock-agentcore:$REGION:$ACCOUNT:runtime/$RUNTIME_ID"
echo "and give the runtime a way back to Berry (BERRY_PUBLIC_URL, a tunnel locally)."
