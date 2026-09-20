# The Berry API for a Docker host. Build context: the repository root.
#
# The same server as server-ts/Dockerfile, with what running on a Docker host
# adds: the docker client. A preview is the pull request's own containers and an
# agent session is a container, and the API starts both through the host's
# Docker socket. Debian rather than Alpine for GNU tar, which unpacks the
# repository archive with the flags the preview code passes.
FROM node:22-bookworm-slim

RUN apt-get update \
   && apt-get install -y --no-install-recommends ca-certificates curl gnupg tar gzip \
   && install -m 0755 -d /etc/apt/keyrings \
   && curl -fsSL https://download.docker.com/linux/debian/gpg -o /etc/apt/keyrings/docker.asc \
   && echo "deb [arch=$(dpkg --print-architecture) signed-by=/etc/apt/keyrings/docker.asc] https://download.docker.com/linux/debian bookworm stable" > /etc/apt/sources.list.d/docker.list \
   && apt-get update \
   && apt-get install -y --no-install-recommends docker-ce-cli docker-buildx-plugin \
   && rm -rf /var/lib/apt/lists/*

WORKDIR /app
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

COPY server-ts/package.json server-ts/pnpm-lock.yaml ./
RUN pnpm install --prod --frozen-lockfile --ignore-workspace

COPY server-ts/tsconfig.json ./
COPY server-ts/src ./src
COPY server-ts/migrations ./migrations
# The preview image's source, where the server looks for it. The release
# pulls that image ready-made; this is what a host without it builds from.
COPY server-ts/sandbox/preview ./sandbox/preview

ENV NODE_ENV=production
ENV API_ADDR=0.0.0.0:4000
EXPOSE 4000
# The server does not migrate by itself, so the container does it first: a new
# install starts from an empty database, and a release may carry a migration.
# Forward-only and checksummed, so running it on every start is safe. If it
# fails the server is not started against a schema it does not match.
CMD ["sh", "-c", "node --experimental-strip-types --no-warnings src/migrate/index.ts up && exec node --experimental-strip-types --no-warnings src/index.ts"]
