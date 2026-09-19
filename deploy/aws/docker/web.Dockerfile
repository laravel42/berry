# The Berry web app as Next's standalone server. Build context: the repository root.
#
# The frontend is one package of a pnpm workspace, so the install happens at the
# workspace root and the standalone output keeps that layout: the server is at
# frontend/server.js inside it.
FROM node:22-bookworm-slim AS build
WORKDIR /repo
RUN corepack enable && corepack prepare pnpm@10.12.1 --activate

COPY pnpm-workspace.yaml package.json pnpm-lock.yaml .npmrc ./
COPY frontend/package.json frontend/
COPY packages/plugin-sdk/package.json packages/plugin-sdk/
COPY server-ts/package.json server-ts/
RUN pnpm install --frozen-lockfile --filter berry-frontend...

COPY frontend frontend
# Where `/api/*` is rewritten to is fixed when the app is built. The web server
# runs on the host's network beside the API, so that is loopback; browsers
# reach the API through the load balancer and never through this.
ENV BERRY_API_ORIGIN=http://127.0.0.1:4000
ENV NEXT_TELEMETRY_DISABLED=1
RUN pnpm --filter berry-frontend build

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
