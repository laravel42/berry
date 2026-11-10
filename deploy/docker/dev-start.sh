#!/usr/bin/env bash
# Starts one of the development services inside its container:
# `dev-start.sh install|api|sessions|web`, for the `dev` profile of the root
# compose.yaml. `install` runs once, before the others, so two of them never
# install into the same node_modules at once.
#
# The repository's .env is written for processes running on the Mac itself.
# Two things differ in a container, and both are put right here rather than by
# asking anyone to keep a second .env:
#
#   * DATABASE_URL is set by compose to the dev-postgres service. A leftover
#     localhost in S3_ENDPOINT still means the Mac, reached at
#     host.docker.internal.
#   * The containers the API and the router start are published on the Mac's
#     loopback, which from in here is host.docker.internal too. It is given as
#     an address, not a name: it becomes the Host header a preview's server
#     sees, and Vite refuses a host name it was not told about.
set -euo pipefail

host_ip="$(getent hosts host.docker.internal | awk '{print $1; exit}')"
[ -n "$host_ip" ] || { echo "host.docker.internal does not resolve in this container (Docker Desktop, Colima and OrbStack all provide it)." >&2; exit 1; }
export BERRY_DOCKER_PUBLISH_ADDR=127.0.0.1
export BERRY_DOCKER_HOST_ADDR="$host_ip"

onto_host() { printf '%s' "$1" | sed -E 's#(://([^/@]*@)?)(localhost|127\.0\.0\.1)([:/])#\1host.docker.internal\4#'; }

case "${1:-}" in
   install)
      cd /repo
      # The server and the web app, from the root lockfile, into the volumes
      # the other services mount; the rest of the workspace is not needed here.
      bun install --frozen-lockfile --filter @berry/server --filter berry-frontend
      # The marketing site, which the web app's dev script builds first. Its
      # own lockfile, outside the workspace.
      cd /repo/apps/web
      exec bun install --frozen-lockfile
      ;;
   api)
      cd /repo/server-ts
      export DATABASE_URL="$(onto_host "${DATABASE_URL:?DATABASE_URL is not set}")"
      [ -z "${S3_ENDPOINT:-}" ] || export S3_ENDPOINT="$(onto_host "$S3_ENDPOINT")"
      if ! node -e '
         const url = new URL(process.env.DATABASE_URL);
         const socket = require("net").connect(Number(url.port || 5432), url.hostname);
         socket.setTimeout(4000);
         socket.on("connect", () => process.exit(0));
         for (const event of ["error", "timeout"]) socket.on(event, () => process.exit(1));
      '; then
         echo "PostgreSQL is not answering (the compose dev-postgres service)." >&2
         echo "Check: docker compose -p berry-dev logs dev-postgres" >&2
         exit 1
      fi
      # Forward-only and checksummed: a pull that brought a migration does not
      # leave the server crashing against yesterday's schema.
      node --experimental-strip-types --no-warnings src/migrate/index.ts up
      exec node --watch --experimental-strip-types --no-warnings src/index.ts
      ;;
   sessions)
      # No install: the router is Node's own modules and nothing else.
      cd /repo/server-ts
      # Exactly what the runtime reads, as scripts/runtime-docker.sh filters it:
      # an agent's commands run in these containers and have no business near
      # the database URL, the auth secret or the integration key.
      umask 077
      printenv | grep -E '^(BERRY_AGENTCORE_REGION|BERRY_AGENTCORE_ACCESS_KEY_ID|BERRY_AGENTCORE_SECRET_ACCESS_KEY|BERRY_AGENTCORE_SESSION_TOKEN|BERRY_BEDROCK_REGION|BERRY_BEDROCK_ACCESS_KEY_ID|BERRY_BEDROCK_SECRET_ACCESS_KEY|BERRY_BEDROCK_SESSION_TOKEN|AWS_REGION|BERRY_RUNTIME_AUTH_MODE|BERRY_RUNTIME_AUTH_TOKEN|BERRY_RUNTIME_LOCAL_CONTROL|OTEL_[A-Z0-9_]+)=' > /run/runtime.env || true
      export BERRY_ROUTER_ENV_FILE=/run/runtime.env
      exec node --experimental-strip-types --no-warnings src/runtime/local-router/main.ts
      ;;
   web)
      cd /repo/frontend
      exec bun run dev --hostname 0.0.0.0
      ;;
   *)
      echo "usage: dev-start.sh install|api|sessions|web" >&2
      exit 1
      ;;
esac
