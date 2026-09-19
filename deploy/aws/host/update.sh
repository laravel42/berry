#!/usr/bin/env bash
# Applies a release on the Berry host. Run by the stack's State Manager
# association, as root, with the BERRY_* settings exported; safe to run again.
#
#   1. what the machine needs, once: Docker, compose, the data volume at /data
#   2. the application's secrets: generated ones made and written back, all read
#   3. the env files, the images, `docker compose up`
#   4. the API answering, or the release fails with its log
set -euo pipefail
umask 077

for name in BERRY_DOMAIN BERRY_PREVIEW_DOMAIN BERRY_REGION BERRY_BEDROCK_REGION BERRY_BUCKET BERRY_APP_SECRET BERRY_BEDROCK_SECRET BERRY_REGISTRY BERRY_IMAGE_API BERRY_IMAGE_WEB BERRY_IMAGE_RUNTIME BERRY_IMAGE_PREVIEW; do
   [ -n "${!name:-}" ] || { echo "$name is not set" >&2; exit 1; }
done
export AWS_DEFAULT_REGION="$BERRY_REGION"
here="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
first_install=true
[ -f /opt/berry/.installed ] && first_install=false

# ── 1. The machine ──────────────────────────────────────────────────────────
if ! command -v docker >/dev/null || ! command -v jq >/dev/null; then
   dnf install -y -q docker jq
fi
if ! docker compose version >/dev/null 2>&1; then
   arch="$(uname -m)" # aarch64 | x86_64, which is how the release files are named
   install -d /usr/local/lib/docker/cli-plugins
   curl -fsSL "https://github.com/docker/compose/releases/download/v2.39.2/docker-compose-linux-${arch}" -o /usr/local/lib/docker/cli-plugins/docker-compose
   chmod 0755 /usr/local/lib/docker/cli-plugins/docker-compose
fi
systemctl enable --now docker

# The data volume is attached as /dev/sdf; on a Nitro instance that name is a
# link to the NVMe device. Formatted only when it holds no filesystem at all.
if ! mountpoint -q /data; then
   for _ in $(seq 1 60); do [ -e /dev/sdf ] && break; sleep 2; done
   [ -e /dev/sdf ] || { echo "the data volume (/dev/sdf) is not attached" >&2; exit 1; }
   device="$(readlink -f /dev/sdf)"
   if ! blkid "$device" >/dev/null 2>&1; then mkfs.xfs -q "$device"; fi
   mkdir -p /data
   grep -q ' /data ' /etc/fstab || echo "UUID=$(blkid -s UUID -o value "$device") /data xfs defaults,nofail 0 2" >> /etc/fstab
   mount /data
fi
mkdir -p /data/postgres /opt/berry/env /root/.cache/berry/previews

# ── 2. Secrets ──────────────────────────────────────────────────────────────
# What can be generated is, once, and is written back to Secrets Manager: the
# integration key seals every stored credential, and must not exist only here.
secret="$(aws secretsmanager get-secret-value --secret-id "$BERRY_APP_SECRET" --query SecretString --output text)"
printf '%s\n' "$secret" | jq -e 'type == "object"' >/dev/null || { echo "the application secret is not a JSON object" >&2; exit 1; }
merged="$secret"
ensure() { # name, value
   if [ -z "$(printf '%s\n' "$merged" | jq -r --arg n "$1" '.[$n] // ""')" ]; then
      merged="$(printf '%s\n' "$merged" | jq --arg n "$1" --arg v "$2" '.[$n] = $v')"
   fi
}
ensure BERRY_AUTH_SECRET "$(openssl rand -base64 48 | tr -d '\n')"
ensure INTEGRATION_ENCRYPTION_KEY "$(openssl rand -base64 32 | tr -d '\n')"
ensure BERRY_RUNTIME_AUTH_TOKEN "$(openssl rand -hex 32)"
ensure POSTGRES_PASSWORD "$(openssl rand -hex 24)"
if [ "$merged" != "$secret" ]; then
   aws secretsmanager put-secret-value --secret-id "$BERRY_APP_SECRET" --secret-string "$merged" >/dev/null
   secret="$merged"
fi
value() { printf '%s\n' "$secret" | jq -r --arg n "$1" '.[$n] // ""'; }
bedrock="$(aws secretsmanager get-secret-value --secret-id "$BERRY_BEDROCK_SECRET" --query SecretString --output text)"

# ── 3. Env files, images, containers ────────────────────────────────────────
cat > /opt/berry/env/postgres.env <<ENV
POSTGRES_USER=berry
POSTGRES_DB=berry
POSTGRES_PASSWORD=$(value POSTGRES_PASSWORD)
ENV

# What the stack knows first, then the secret: a name set there wins, so any
# variable the API reads can be set or overridden without a change here.
{
   cat <<ENV
APP_ENV=production
SERVICE_NAME=berry-server
DATABASE_URL=postgres://berry:$(value POSTGRES_PASSWORD)@127.0.0.1:5432/berry?sslmode=disable
BERRY_APP_URL=https://${BERRY_DOMAIN}
BERRY_PUBLIC_URL=https://${BERRY_DOMAIN}
BERRY_RUNTIME_CALLBACK_URL=https://${BERRY_DOMAIN}
BERRY_PREVIEW_DOMAIN=${BERRY_PREVIEW_DOMAIN}
BERRY_PREVIEW_SCHEME=https
BERRY_PREVIEW_PORT=default
BERRY_AGENT_RUNTIME_URL=http://127.0.0.1:8080
BERRY_BEDROCK_REGION=${BERRY_BEDROCK_REGION}
S3_BUCKET=${BERRY_BUCKET}
S3_REGION=${BERRY_REGION}
AWS_REGION=${BERRY_REGION}
ENV
   printf '%s\n' "$secret" | jq -r 'to_entries[] | select(.key != "POSTGRES_PASSWORD") | select((.value | type) == "string" and (.value | contains("\n") | not)) | "\(.key)=\(.value)"'
} > /opt/berry/env/api.env

# A session runs the task's commands. It is given what the runtime reads and
# nothing of the API's: no database URL, no auth secret, no integration key.
cat > /opt/berry/env/runtime.env <<ENV
BERRY_BEDROCK_REGION=${BERRY_BEDROCK_REGION}
AWS_REGION=${BERRY_BEDROCK_REGION}
BERRY_BEDROCK_ACCESS_KEY_ID=$(printf '%s\n' "$bedrock" | jq -r .accessKeyId)
BERRY_BEDROCK_SECRET_ACCESS_KEY=$(printf '%s\n' "$bedrock" | jq -r .secretAccessKey)
BERRY_RUNTIME_AUTH_TOKEN=$(value BERRY_RUNTIME_AUTH_TOKEN)
ENV
chmod 0600 /opt/berry/env/*.env

aws ecr get-login-password | docker login --username AWS --password-stdin "$BERRY_REGISTRY" >/dev/null
for image in "$BERRY_IMAGE_API" "$BERRY_IMAGE_WEB" "$BERRY_IMAGE_RUNTIME" "$BERRY_IMAGE_PREVIEW"; do docker pull -q "$image"; done
# The names the server starts sessions and previews by.
docker tag "$BERRY_IMAGE_RUNTIME" berry-agent-runtime
docker tag "$BERRY_IMAGE_PREVIEW" berry-preview:node22

export BERRY_IMAGE_API BERRY_IMAGE_WEB
docker compose -f "$here/compose.yml" up -d --remove-orphans

# ── 4. Did it come up ───────────────────────────────────────────────────────
ready=false
for _ in $(seq 1 60); do
   if curl -fsS -o /dev/null http://127.0.0.1:4000/ready; then ready=true; break; fi
   sleep 3
done
if [ "$ready" != true ]; then
   echo "the API did not answer /ready within three minutes. Its last lines:" >&2
   docker compose -f "$here/compose.yml" logs --tail 60 api >&2 || true
   # A first install is left standing to be looked at (Session Manager); a
   # release that breaks a working host fails the deploy.
   [ "$first_install" = true ] || exit 1
fi
[ -n "$(value BERRY_AUTH_GITHUB_CLIENT_ID)" ] || echo "note: BERRY_AUTH_GITHUB_CLIENT_ID is not in the application secret yet, so nobody can sign in." >&2

touch /opt/berry/.installed
docker image prune -af --filter 'until=168h' >/dev/null || true
echo "berry is up: https://${BERRY_DOMAIN}"
