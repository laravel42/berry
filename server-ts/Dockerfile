# The Berry product server.
#
# No build step: Node strips the types at load, so the image runs the same
# sources development runs. There is no transpiled artefact that can diverge
# from what was tested.
FROM node:22-alpine

WORKDIR /app

# Bun is the project's package manager, pinned to the workspace's version;
# Node still runs the server. The musl build, for Alpine.
COPY --from=oven/bun:1.4.4-alpine /usr/local/bin/bun /usr/local/bin/bun

# Dependencies first, so a source change does not reinstall them. The
# standalone lockfile is committed alongside package.json (bun run
# lock:server); --frozen-lockfile refuses to drift from it.
COPY package.json bun.lock ./
COPY patches ./patches
RUN bun install --production --frozen-lockfile && rm -rf /root/.bun/install/cache

COPY tsconfig.json ./
COPY src ./src
# The schema. Shipped in the image because the migrator runs from it at boot,
# and a server whose migrations live somewhere else can start against a
# database it does not match.
COPY migrations ./migrations

ENV NODE_ENV=production
ENV API_ADDR=0.0.0.0:4000
EXPOSE 4000

# --experimental-strip-types is what lets the .ts sources run directly. It is
# the same flag development uses, so there is no build to diverge from.
CMD ["node", "--experimental-strip-types", "src/index.ts"]
