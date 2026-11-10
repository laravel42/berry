# The Berry web app as Next's standalone server. Build context: the repository root.
#
# The frontend is one package of a Bun workspace, so the install happens at the
# workspace root and the standalone output keeps that layout: the server is at
# frontend/server.js inside it. The build first renders the marketing site
# (apps/web, its own install) into frontend/public, so that comes along too.
FROM oven/bun:1.4.4 AS bun

# Only the manifests, at their paths. A frozen install checks every workspace
# the lockfile names, so all of them are needed, and copying just these keeps
# the install layer below cached until a dependency changes.
FROM node:22-bookworm-slim AS manifests
WORKDIR /repo
COPY . .
RUN mkdir /out \
   && find . -name node_modules -prune -o \( -name package.json -o -name bun.lock -o -name bunfig.toml \) -print \
      | xargs -I{} cp --parents {} /out

FROM node:22-bookworm-slim AS build
COPY --from=bun /usr/local/bin/bun /usr/local/bin/bun
WORKDIR /repo
COPY --from=manifests /out ./
# The server's patched dependency is part of the root lockfile, so its patch
# has to be present for the install, even though the web package does not use it.
COPY server-ts/patches server-ts/patches
RUN bun install --frozen-lockfile --filter berry-frontend \
   && (cd apps/web && bun install --frozen-lockfile) \
   && rm -rf /root/.bun/install/cache

COPY frontend frontend
COPY apps/web apps/web
COPY scripts/prepare-marketing.mjs scripts/
# Where `/api/*` is rewritten to is fixed when the app is built, so it is a
# build argument: loopback where the web server shares the host's network with
# the API (deploy/aws), the API's service name where both are containers on
# one network (compose.yaml: http://api:4000).
ARG BERRY_API_ORIGIN=http://127.0.0.1:4000
ENV BERRY_API_ORIGIN=${BERRY_API_ORIGIN}
ENV NEXT_TELEMETRY_DISABLED=1
# The marketing site's assets are copied into frontend/public, not linked:
# only that folder reaches the final image.
ENV BERRY_MARKETING_COPY=1
RUN cd frontend && bun run build

FROM node:22-bookworm-slim
WORKDIR /app
ENV NODE_ENV=production
ENV NEXT_TELEMETRY_DISABLED=1
ENV HOSTNAME=0.0.0.0
ENV PORT=3000
COPY --from=build /repo/frontend/.next/standalone ./
COPY --from=build /repo/frontend/.next/static ./frontend/.next/static
COPY --from=build /repo/frontend/public ./frontend/public
USER node
EXPOSE 3000
CMD ["node", "frontend/server.js"]
