## Who this page is for
This page is for the person who runs a Berry installation: installs it, keeps it healthy, backs it up and upgrades it. For first-time setup, start with [Quick start](quickstart.html). For every environment variable, see [Configuration reference](configuration.html).

## What you are running
| Component | What it does | Holds state? |
| --- | --- | --- |
| Web app (`web`, port 3000) | The Next.js interface. Proxies `/api` and `/v1` to the API. | No |
| API (`api`, port 4000) | Owns all product state, sign-in, credentials and the run dispatcher. Starts preview containers. | No, all state is in PostgreSQL |
| PostgreSQL 16 (`postgres`) | Every record: tasks, runs, agents, sealed credentials, outbox events. | **Yes** |
| Object storage (S3 or compatible) | Attachments and run artifacts. | **Yes** |
| Agent runtime | Executes agent runs: the `sessions` router (one container per run) or AgentCore in AWS. | No |

Browsers talk only to the web app and the API. Agents talk to Berry only through `/api/v1/agent-tools/*` with a run token, never to the database.

## Choose how to run it
- **Docker, self-hosted.** The root `compose.yaml` runs `postgres`, `api`, `sessions` and `web`, plus two one-shot services: `preflight` checks the required variables and `runtime-image` builds the agent runtime image. Start it with `docker compose up -d --build`. The full guide, including Dokploy and Cloudflare tunnel setup, is in `deploy/docker/README.md`.
- **Local development.** `bun run dev:docker` runs the same stack from your working tree under the `dev` profile. Or run `bun run dev:server` and `bun run dev:frontend` on the host against PGlite.
- **AWS.** The CDK stack in `deploy/aws` ships its own compose file with prebuilt images.

The rest of this page uses the Docker self-host stack in its examples. Run the `docker compose` commands from the directory that holds `compose.yaml`. Under Dokploy, use the service's Logs tab and Environment tab instead.

## Secrets to keep safe
Generate these once and store them outside the repository, for example in a password manager. Keep them the same across upgrades.

| Variable | What it protects | If you lose it |
| --- | --- | --- |
| `INTEGRATION_ENCRYPTION_KEY` | Seals every stored credential: AI provider tokens, source-control tokens, plugin secrets, MCP headers, agent environment variables. | Stored credentials cannot be decrypted. People have to reconnect each one. |
| `POSTGRES_PASSWORD` | The database. | You need it to reach the database. |
| `BERRY_AUTH_SECRET` | Sign-in sessions. | Keep it stable. |
| `BERRY_RUNTIME_AUTH_TOKEN` | Calls between the API and the agent runtime. Both sides must hold the same value. | Set a new one on both sides. |

Generate secrets with `openssl rand -base64 32` (`openssl rand -hex 24` for the database password). Berry has no built-in rotation for the encryption key. A database backup is useless for credentials without the key that sealed them, so back up both.

## Check that it is healthy
| Endpoint | Answers |
| --- | --- |
| `GET /health` | `{"status":"ok"}` while the API process is up. Use it for liveness. |
| `GET /ready` (also `/readyz`) | Whether the API can reach the database and its other probes, with one result per check. Use it for readiness and load balancers. |
| `GET /metrics` | Prometheus metrics, including the server version. Off when `METRICS_ENABLED=false`. |
| `GET /api/v1/config` | What this deployment can actually do: `agentExecution`, `voiceAgents`, `metrics` and more, plus the server version. |

```sh
curl -fsS https://berry.example.com/ready
curl -fsS https://berry.example.com/api/v1/config
```

A healthy API is not a working agent runtime. Also watch for runs that stay queued or fail: Settings → Usage shows runs in progress and the failure rate, and the Agents page shows runs against failures per agent.

## Read the logs
```sh
docker compose logs -f api
docker compose logs --since 1h sessions
docker compose ps
```
Each service writes JSON-file logs capped at five files of 20 MB. Preview containers appear in `docker ps` as `berry-pv-…` and agent session containers as `berry-rt-…`. Berry starts and stops them itself. `preflight` and `runtime-image` show as exited; that is intended.

## Back up
Back up three things together: the database, the object store and the encryption key.

**Database (Docker stack).** The database lives in the `berry-postgres` volume. Take a dump while Berry runs:
```sh
docker compose exec -T postgres pg_dump -U berry -Fc berry > berry-$(date +%F).dump
```
Copy the dump off the server. Test a restore from time to time, on another machine.

**Database (host PostgreSQL).** Run `pg_dump -Fc` against the URL in `DATABASE_URL`.

**PGlite (local development).** The database is the directory named in `DATABASE_URL` (`pglite:./.berry` by default). Stop the server before copying it.

**Object storage.** Use your provider's versioning or replication for the bucket in `S3_BUCKET`. Attachments and run artifacts live only there.

## Restore
Restore the database, the bucket and the matching encryption key together, from the same point in time.

1. Stop the services that write: `docker compose stop web api sessions`.
2. Recreate the database and load the dump:
   ```sh
   docker compose exec -T postgres dropdb -U berry berry
   docker compose exec -T postgres createdb -U berry berry
   docker compose exec -T postgres pg_restore -U berry -d berry --no-owner < berry-2026-11-10.dump
   ```
3. Check out the Berry revision the backup was taken with, or a later one. The migration runner stops with "missing from this build" when the database holds a migration the checkout does not have, and the Docker `api` container then does not start.
4. Start again with `docker compose up -d` and check `/ready`.

`dropdb` deletes the current database. Take a fresh dump first if there is anything in it you might want.

## Upgrade
1. **Read what changed.** Check `CHANGELOG.md` and the new migration files in `server-ts/migrations/` between your revision and the target.
2. **Record where you are.** Note the current Git revision so you can come back to it.
3. **Let work finish.** Restarting the API abandons agent runs in flight. Wait for running runs to end, or cancel them, before you upgrade.
4. **Back up** the database and confirm the encryption key is stored.
5. **Deploy the new revision.**
   - Docker: `git pull`, then `docker compose up -d --build`. Only changed images rebuild. The `api` container applies pending migrations before it starts the server. Under Dokploy, push and press Deploy.
   - Host install: `bun install --frozen-lockfile`, `bun run db:migrate`, then restart the API and web app.
6. **Verify.** `/ready` answers 200, `/api/v1/config` shows the new version and the capabilities you expect, and a small test task runs to *In review*.

The `runtime-image` service rebuilds the agent runtime image on each Docker deploy. If you use AgentCore instead, rebuild and publish it with `server-ts/sandbox/agentcore/deploy.sh` and update `BERRY_AGENTCORE_RUNTIME_ARN` if it changes. The API and the runtime image should come from the same revision.

## Migrations
- Migrations are forward-only SQL files in `server-ts/migrations/`, applied in order, one per transaction, under a PostgreSQL advisory lock. Several API instances starting at once do not apply the same migration twice.
- Applied migrations are recorded with a SHA-256 checksum in `berry_schema_migrations`. The runner refuses to continue if an applied file was edited, renamed or removed.
- Re-running `bun run db:migrate` is safe: applied migrations are skipped.
- The `.down.sql` files are never run and are not a rollback. **To roll back, restore the backup you took before the upgrade and check out the matching revision.**
- Never edit an applied migration. A fix is a new, higher-numbered migration.

To see what has been applied:
```sh
docker compose exec -T postgres psql -U berry -d berry -c \
  "SELECT version, name, applied_at FROM berry_schema_migrations ORDER BY version DESC LIMIT 5;"
```

## Capacity and disk
- The `sessions` router runs at most `BERRY_ROUTER_MAX_CONTAINERS` agent sessions at once (8 by default) and stops idle ones. Raise it only if the server has memory and CPU to spare.
- Preview checkouts live in `/var/lib/berry/previews` on the server. Watch its disk use.
- Docker images from earlier builds pile up. Remove unused ones with `docker image prune` once a deploy is healthy.
- The first Docker build needs about 6 GB of free memory and 20 GB of disk.

## Reverse proxies
Forward the API routes and keep authentication cookies intact. Let SSE connections (`/api/v1/events`) stay open and turn off response buffering on them. Serve everything outside your own network over HTTPS, including the runtime callback URL. If an access gateway sits in front of Berry, exempt `/api/auth/callback/*`, `/api/v1/agent-tools/*` and the webhook path, or sign-in and agent sessions break.

## Security upkeep
- The `api` and `sessions` containers hold the Docker socket, which is root on that machine. Run Berry on a server you would trust with that.
- Previews run pull-request code. Give previews their own domain when you work with repositories you do not fully trust; `deploy/docker/README.md` explains why.
- Review members, API tokens and join links in each workspace from time to time, and revoke what is no longer used.
- Keep `.env` files, dumps and the encryption key out of source control and out of tickets.

## Development databases only
These commands are for development and test databases. Never point them at a database people use.
- `bun run db:seed` loads an idempotent development dataset.
- `bun run db:reset yes` empties a development database of work, plans, runs, conversations and integrations, and keeps users, workspaces, agents, skills and Loops. It prints the database it is about to empty and refuses to run without the confirmation word.
- Database-backed tests need their own schema-only database. `server-ts/ROUTING.md` gives the recipe.

## Routine checklist
| How often | Task |
| --- | --- |
| Daily | Check `/ready`, failed runs and the API log for errors. |
| Weekly | Confirm backups ran and were copied off the server. Check disk space for the volume, previews and images. |
| Each upgrade | Changelog, backup, drain runs, deploy, verify. |
| Quarterly | Restore a backup on a spare machine. Review tokens, members and join links. |

## Sources
This page is based on `compose.yaml`, `deploy/docker/README.md`, `deploy/docker/self-host.env.example`, `deploy/docker/api.Dockerfile`, `server-ts/migrations/README.md`, `server-ts/src/reset/index.ts`, `server-ts/src/mounts/platform.ts`, `server-ts/src/config/config.ts` and `PRODUCT.md`.
