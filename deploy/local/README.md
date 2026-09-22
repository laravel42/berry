# Berry for local development, in Docker

One command instead of three terminals:

```bash
pnpm dev:docker          # Ctrl+C stops it; pnpm dev:docker:down removes the containers
```

| Service | What it runs | Where |
| --- | --- | --- |
| `web` | `next dev` | http://localhost:3000 |
| `api` | migrations, then `node --watch` | http://localhost:4000 (previews at `*.preview.localhost:4000`) |
| `sessions` | the session router (what `pnpm runtime:sessions` runs) | inside the compose network |

All three run from the working tree, mounted into the containers, so an edit on the Mac restarts the API or reloads the page as it does today. It reads the repository's `.env` as it is and uses the PostgreSQL already on the Mac; the dev database is not moved into a container.

## Hot reload, and Colima

All three services watch the working tree, so hot reload depends on file-change events crossing from the Mac into the containers. Docker Desktop and OrbStack forward them. **Colima does not by default**: an edit on the Mac then changes the file in the container and nothing notices, so the API is not restarted and an already-compiled page stays stale. Turn it on once:

```bash
colima stop
colima start --mount-inotify      # or set `mountInotify: true` in ~/.colima/default/colima.yaml
```

Stopping Colima stops every container it runs, not only Berry's. To check whether events arrive, change any file while this runs and see whether it prints:

```bash
docker compose -f deploy/local/docker-compose.yml exec web node -e 'require("fs").watch("/repo/deploy/local",(e,f)=>console.log(e,f));setTimeout(()=>{},20000)'
```

Until events arrive, restart a service to pick up edits: `docker compose -f deploy/local/docker-compose.yml restart api` (or `web`).

## Before the first run

- A Docker engine running (Docker Desktop, Colima or OrbStack), and **PostgreSQL running on the Mac** as usual. The API says so and stops when it is not.
- Nothing else on ports 3000 and 4000: stop `pnpm dev:server`, `pnpm dev:frontend` and `pnpm runtime:sessions` first. Run Berry one way or the other, not both.
- An Intel Mac: `BERRY_RUNTIME_PLATFORM=linux/amd64 pnpm dev:docker`.

The first run builds the dev image and the agent runtime image and installs dependencies into Docker volumes: several minutes. Later runs start in seconds.

## What is different from running it on the Mac

`start.sh` adjusts two things instead of asking for a second `.env`:

- `localhost` and `127.0.0.1` in `DATABASE_URL` (and `S3_ENDPOINT`) become `host.docker.internal`, which is the Mac as seen from a container.
- The containers the API and the router start (previews, agent sessions) are published on the Mac's loopback and reached through `host.docker.internal`, resolved to its address at start.

Also:

- The API applies pending migrations when it starts. On the Mac that is a separate `pnpm migrate:server`.
- `node_modules` live in Docker volumes, not in the working tree, because some packages ship per-platform binaries. After changing dependencies, restart the service; to start clean, `pnpm dev:docker:down -v`.
- The web app builds into `frontend/.next-docker`, apart from the Mac's `.next`.
- Editing a file the API imports restarts it, which abandons agent runs in flight, exactly as `node --watch` does on the Mac.

## When something is off

```bash
docker compose -f deploy/local/docker-compose.yml logs -f api
docker compose -f deploy/local/docker-compose.yml restart web
```

- **The API says PostgreSQL is not answering:** start it on the Mac (DBngin, Postgres.app, `brew services`), then restart `api`. It only has to listen on the Mac's loopback, which they all do by default.
- **Sign-in with GitHub fails, or the page shows API errors:** the `api` container is not up. Its log says why.
- **Page reloads feel slow:** file events cross the Mac-to-container boundary. If that bothers you, run `web` on the Mac (`pnpm dev:frontend`) and keep `api` and `sessions` in Docker: `docker compose -f deploy/local/docker-compose.yml up api sessions`, with `BERRY_API_ORIGIN=http://localhost:4000` as it is in `.env`.
