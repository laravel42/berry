#!/usr/bin/env bash
# Builds and runs the agent runtime as one local container (`pnpm runtime:docker`).
#
# Two things differ from a plain `docker run --env-file .env`:
#
#   * The container is given only the variables the runtime reads (see
#     server-ts/src/agents/runtime/container/main.ts), not the whole .env. The
#     database URL, the auth secret and the integration key are the API's; an
#     agent's commands run in this container and have no business near them.
#   * Sessions are isolated from each other: the runtime runs as root with the
#     few capabilities that takes, and gives every session its own unprivileged
#     user and a private workspace (BERRY_RUNTIME_ISOLATE_SESSIONS). A command
#     can then read neither the runtime's environment nor another session's files.
#
# With --per-session (`pnpm runtime:sessions`) no single container is started.
# A small router listens on the same port and starts one such container per
# session, each seeing only its own folder of the workspace volume, with its
# own memory, CPU and process ceiling; idle ones are stopped. That is the shape
# AgentCore gives a session, where it is a microVM and none of this applies.
set -euo pipefail

mode=single
[ "${1:-}" = "--per-session" ] && mode=sessions

root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
env_file="${BERRY_ENV_FILE:-$root/.env}"
name="${BERRY_RUNTIME_CONTAINER:-berry-runtime}"
port="${BERRY_RUNTIME_PORT:-8080}"

# Exactly what main.ts and the telemetry setup read. Add a name here when the
# runtime starts reading a new one; nothing else in .env reaches the container.
allowed='^(BERRY_BEDROCK_REGION|BERRY_BEDROCK_ACCESS_KEY_ID|BERRY_BEDROCK_SECRET_ACCESS_KEY|BERRY_BEDROCK_SESSION_TOKEN|AWS_REGION|BERRY_RUNTIME_AUTH_MODE|BERRY_RUNTIME_AUTH_TOKEN|BERRY_RUNTIME_LOCAL_CONTROL|BERRY_MEDIA_VIDEO_S3_URI|OTEL_[A-Z0-9_]+)='

[ -f "$env_file" ] || { echo "no env file at $env_file" >&2; exit 1; }

docker build -f "$root/server-ts/sandbox/agentcore/Dockerfile" -t berry-agent-runtime "$root/server-ts"

filtered="$(mktemp)"
trap 'rm -f "$filtered"' EXIT
chmod 600 "$filtered"
grep -E "$allowed" "$env_file" > "$filtered" || true
echo "runtime environment: $(cut -d= -f1 "$filtered" | tr '\n' ' ')" >&2

docker rm -f "$name" >/dev/null 2>&1 || true

if [ "$mode" = sessions ]; then
   # Not exec: the env file must outlive every container the router starts,
   # and the trap above removes it when the router ends.
   BERRY_ROUTER_ENV_FILE="$filtered" BERRY_RUNTIME_PORT="$port" \
      node --experimental-strip-types --no-warnings "$root/server-ts/src/runtime/local-router/main.ts"
   exit $?
fi

# Published on loopback only: the API reaches it at localhost, and nothing on
# the network should. Root inside, stripped to what handing out users needs.
exec docker run --rm --init --name "$name" \
   -p "127.0.0.1:${port}:8080" \
   --env-file "$filtered" \
   -e PORT=8080 \
   -e BERRY_RUNTIME_WORK_ROOT=/mnt/workspace \
   -e BERRY_RUNTIME_ISOLATE_SESSIONS=true \
   --user 0:0 \
   --cap-drop ALL \
   --cap-add SETUID --cap-add SETGID --cap-add CHOWN \
   --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add KILL \
   --security-opt no-new-privileges \
   --pids-limit 4096 \
   -v berry-runtime-work:/mnt/workspace \
   berry-agent-runtime
