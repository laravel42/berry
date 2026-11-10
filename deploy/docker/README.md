# Berry in Docker

Everything Docker runs for Berry is in one file, [`compose.yaml`](../../compose.yaml) at the repository root:

| | Services | Run with |
| --- | --- | --- |
| **Self-host** (Dokploy, or any Docker host) | `postgres`, `api`, `sessions`, `web`, plus `preflight` and `runtime-image`, which run once and exit | `docker compose up -d --build` |
| **Local development** | `dev-postgres`, `dev-api`, `dev-sessions`, `dev-web`, `dev-runtime-image` (profile `dev`) | `pnpm dev:docker` |

The images are built from this folder: `api.Dockerfile` (the API and the session router), `web.Dockerfile` (the web app), `dev.Dockerfile` with `dev-start.sh` (development). The agent runtime image is `server-ts/sandbox/agentcore/Dockerfile`.

The AWS host is not part of this file: the CDK stack ships [`deploy/aws/host/compose.yml`](../aws/host/compose.yml) to the server, with prebuilt images and the host's network (see [deploy/aws](../aws/README.md)).

---

## Self-host

PostgreSQL, the API, the web app and the agent session router, built on the server from this repository. Written for Dokploy on a server on a private network (`192.168.0.100`) published through a Cloudflare tunnel at `dev.berry.pm`.

```
browser ─ HTTPS ─ Cloudflare ═ tunnel ═ Traefik :80 ─┬─ dev.berry.pm ────── web :3000 ─ /api, /v1 ─┐
                                                     └─ p-….berry.pm ─────────────────────────────── api :4000
                                                            sessions :8080 ← api              postgres :5432
```

Cloudflare ends TLS and the tunnel speaks plain HTTP to Traefik, so the server needs no certificate and no open port. Berry is told its public scheme is `https` (`BERRY_SCHEME`), which is what it puts in links, callbacks and preview addresses.

The API starts a preview's containers, and the session router starts one container per agent run, both through the server's Docker socket. Those are siblings of Berry's containers, so they are published on the Docker bridge address (`172.17.0.1`, reachable from containers and the server itself, not from the network) and reached at that address. By address rather than by name on purpose: it becomes the Host header a preview's server sees, and Vite and other dev servers accept any IP address but refuse a host name they were not told about.

`preflight` checks the required variables first and fails the deploy, naming what is missing, before PostgreSQL or the API start without them.

### The tunnel

In Cloudflare Zero Trust → Networks → Tunnels → your tunnel → Public hostnames, two entries, both to Traefik:

| Public hostname | Service |
| --- | --- |
| `dev.berry.pm` | `http://localhost:80` |
| `*.berry.pm` | `http://localhost:80` |

Use `http://dokploy-traefik:80` instead when `cloudflared` runs as a container on `dokploy-network`. The wildcard entry does not create its DNS record: add a proxied `CNAME` named `*` pointing at `<tunnel id>.cfargotunnel.com`. Hostnames with their own record (`berry.pm`, `www`, `local`) keep going where they go today; the wildcard only catches names that have none, and Traefik answers 404 for any that is not a preview.

### Preview hostnames

A preview answers at `p-<id>-<app>.<preview domain>`, a different host per preview. Cloudflare's free certificate covers `berry.pm` and `*.berry.pm`: one level. `p-….preview.dev.berry.pm` is three levels down and browsers would refuse it. So:

- **Free:** `BERRY_PREVIEW_DOMAIN=berry.pm`, previews at `p-….berry.pm`. This is what `self-host.env.example` sets. The cost: a preview runs a pull request's code on a sibling host of your real sites, and a page there can set a cookie for `.berry.pm` that those sites then receive. Berry itself strips its own cookies from preview traffic and never sends them to one. Acceptable for your own repositories; not for untrusted ones.
- **Isolated:** a separate cheap domain for previews on the same tunnel (`BERRY_PREVIEW_DOMAIN=berry-previews.dev`, wildcard `*.berry-previews.dev`), or Cloudflare Advanced Certificate Manager for `*.preview.dev.berry.pm`.

### Install on Dokploy

1. **Server:** needs about 6 GB of free memory for the first build (the web app's build is the heavy part) and 20 GB of disk. Then, once:
   ```bash
   sudo mkdir -p /var/lib/berry/previews
   ip -4 addr show docker0        # expect 172.17.0.1; if not, set DOCKER_BRIDGE_ADDR to what it says
   ```
   If the server runs a firewall (ufw), allow the Docker networks to reach the bridge address: `sudo ufw allow from 172.16.0.0/12 to 172.17.0.1`.
2. **Dokploy:** Project → Create Service → **Compose**. Provider: this Git repository and branch. Compose path: `compose.yaml`.
3. **Environment tab:** paste [`self-host.env.example`](self-host.env.example) and fill it in. Generate the four secrets with `openssl rand -base64 32` (`openssl rand -hex 24` for the database password). Keep `INTEGRATION_ENCRYPTION_KEY` somewhere safe: it seals every stored credential and build variable.
4. **Domains tab:** add `dev.berry.pm` → service `web`, port `3000`, HTTPS **off** (Cloudflare holds the certificate; turning it on makes Traefik redirect the tunnel's HTTP in a loop). The preview route is already in the compose file, because it is a pattern and the Domains tab takes one host.
5. **Deploy.** The first deploy builds three images and takes 10 to 15 minutes. The `api` container applies the database migrations before it starts the server.
6. **Sign-in:** create a GitHub OAuth App with callback `https://dev.berry.pm/api/auth/callback/github`, put its id and secret in the Environment tab, deploy again.

Check it: `https://dev.berry.pm/ready` answers `200`.

**Moving an existing Dokploy service** from `deploy/dokploy/docker-compose.yml`: change its compose path to `compose.yaml` and deploy. The services and the `berry-postgres` volume keep their names, and Dokploy names the project after the service, so the database carries over. Check that `docker volume ls` shows no second, empty `…_berry-postgres` after the first deploy.

### Without Dokploy

On any Docker host: create the `dokploy-network` network once (`docker network create dokploy-network`, the routes are only used by Traefik), put the variables from `self-host.env.example` in a `.env` beside `compose.yaml`, and run `docker compose up -d --build`. Put a reverse proxy of your own in front of `web` (port 3000) and of the preview hosts (`api`, port 4000).

### Things to know behind the tunnel

- **GitHub webhooks work**, since `dev.berry.pm` is public: set `BERRY_GITHUB_WEBHOOK_SECRET` to enable the inbound route.
- **Long requests:** Cloudflare drops a response that stays silent for 100 seconds. Berry's event stream and the build terminal write continuously, so they hold. A single preview page that takes longer than that to answer will show Cloudflare's 524.
- **Agent sessions call the API back** at `https://dev.berry.pm`, out through Cloudflare and in again. It works and costs a few milliseconds per tool call. To keep it on the machine, set `BERRY_RUNTIME_CALLBACK_URL` to an address the session containers can reach directly.
- **Cloudflare Access:** if you put Access in front of `dev.berry.pm`, exempt `/api/auth/callback/*`, `/api/v1/agent-tools/*` and the webhook path, or GitHub and the agent sessions are asked to log in. Do not put Access in front of preview hosts that agents' tests need to reach.
- **Models** come from a connected subscription AI runtime. There is no native Bedrock or Kilo path. `BERRY_BEDROCK_*` is only a legacy name for AgentCore AWS credentials.

### Without the tunnel

On the private network alone, no DNS is needed: `BERRY_SCHEME=http`, `BERRY_DOMAIN=berry.192.168.0.100.sslip.io`, `BERRY_PREVIEW_DOMAIN=preview.192.168.0.100.sslip.io` (and its escaped form). Every name under `192.168.0.100.sslip.io` resolves to the server. If they do not resolve, the router is filtering private addresses out of DNS answers ("DNS rebind protection"); exempt `sslip.io` there. GitHub webhooks cannot reach a private address.

When Traefik itself must serve HTTPS (a public server with no tunnel): turn HTTPS on in the Domains tab, and in `compose.yaml` change the preview router's entrypoint to `websecure` and uncomment its two `tls` lines. Preview hosts are a wildcard, which Let's Encrypt issues only by DNS challenge, so that resolver has to be added to Dokploy's Traefik first.

### Operating it

- **Update:** push, then Deploy (or turn on Auto Deploy). Only changed images rebuild.
- **Logs:** the service's Logs tab, per container (`api`, `web`, `sessions`, `postgres`).
- **Backup:** the database is the `berry-postgres` volume. `docker exec <postgres container> pg_dump -U berry berry > berry.sql`, or a Dokploy volume backup.
- **`preflight` and `runtime-image` show as exited:** intended. One checks the variables, the other builds the image agent sessions start from.
- Previews and agent sessions appear in `docker ps` as `berry-pv-…` and `berry-rt-…`. They are Berry's, started and stopped by it; Dokploy does not list them.

### Security

The API and the session router hold the server's Docker socket, which is root on that machine: run Berry on a server you would give it. Previews run a pull request's code in containers with no capabilities, memory, CPU and process limits; agent sessions are isolated from each other the same way. Neither gets the socket.

---

## Local development

One command instead of three terminals:

```bash
pnpm dev:docker          # Ctrl+C stops it; pnpm dev:docker:down removes the containers
```

That is `docker compose -p berry-dev --profile dev up --build dev-api dev-sessions dev-web`; the database and the runtime image come along as dependencies.

| Service | What it runs | Where |
| --- | --- | --- |
| `dev-web` | `next dev` | http://localhost:3000 |
| `dev-api` | migrations, then `node --watch` | http://localhost:4000 (previews at `*.preview.localhost:4000`) |
| `dev-sessions` | the session router (what `pnpm runtime:sessions` runs) | http://localhost:8080 |
| `dev-postgres` | PostgreSQL 16 | inside the compose network (volume `postgres`) |

`dev-web`, `dev-api` and `dev-sessions` run from the working tree, mounted into the containers, so an edit on the Mac restarts the API or reloads the page as it does today. They read the repository's `.env` except `DATABASE_URL`, which compose points at `dev-postgres`. The Mac database is not used. `pnpm dev:server` on the host still uses `.env` as before.

The project is named `berry-dev` (the `-p` in the scripts), so it is apart from a self-hosted stack on the same machine, and a stack started from the old `deploy/local` keeps its database and installed dependencies: the volume names did not change.

### Hot reload, and Colima

All three services watch the working tree, so hot reload depends on file-change events crossing from the Mac into the containers. Docker Desktop and OrbStack forward them. **Colima does not by default**: an edit on the Mac then changes the file in the container and nothing notices, so the API is not restarted and an already-compiled page stays stale. Turn it on once:

```bash
colima stop
colima start --mount-inotify      # or set `mountInotify: true` in ~/.colima/default/colima.yaml
```

Stopping Colima stops every container it runs, not only Berry's. To check whether events arrive, change any file while this runs and see whether it prints:

```bash
docker compose -p berry-dev exec dev-web node -e 'require("fs").watch("/repo/deploy/docker",(e,f)=>console.log(e,f));setTimeout(()=>{},20000)'
```

Until events arrive, restart a service to pick up edits: `docker compose -p berry-dev restart dev-api` (or `dev-web`).

### Before the first run

- A Docker engine running (Docker Desktop, Colima or OrbStack). PostgreSQL runs in this stack; the Mac database is not required.
- Nothing else on ports 3000, 4000 and 8080: stop `pnpm dev:server`, `pnpm dev:frontend` and `pnpm runtime:sessions` first. Run Berry one way or the other, not both.
- Not an Apple Silicon Mac (an Intel Mac, or x86 Linux): `BERRY_RUNTIME_PLATFORM=linux/amd64 pnpm dev:docker`.

The first run builds the dev image and the agent runtime image and installs dependencies into Docker volumes: several minutes. Later runs start in seconds.

### What is different from running it on the Mac

`dev-start.sh` adjusts two things instead of asking for a second `.env`:

- `localhost` and `127.0.0.1` in `S3_ENDPOINT` become `host.docker.internal`, which is the Mac as seen from a container. `DATABASE_URL` already names `dev-postgres`.
- The containers the API and the router start (previews, agent sessions) are published on the Mac's loopback and reached through `host.docker.internal`, resolved to its address at start.

Also:

- The API applies pending migrations when it starts. On the Mac that is a separate `pnpm db:migrate`.
- `node_modules` live in Docker volumes, not in the working tree, because some packages ship per-platform binaries. After changing dependencies, restart the service; to start clean, `pnpm dev:docker:down -v`.
- The web app builds into `frontend/.next-docker`, apart from the Mac's `.next`.
- Editing a file the API imports restarts it, which abandons agent runs in flight, exactly as `node --watch` does on the Mac.

### When something is off

```bash
docker compose -p berry-dev logs -f dev-api
docker compose -p berry-dev restart dev-web
```

- **The API says PostgreSQL is not answering:** `docker compose -p berry-dev logs dev-postgres`, then restart `dev-api`. To wipe this stack's database: `pnpm dev:docker:down -v`.
- **Sign-in with GitHub fails, or the page shows API errors:** the `dev-api` container is not up. Its log says why.
- **Page reloads feel slow:** file events cross the Mac-to-container boundary. If that bothers you, run the web app on the Mac (`pnpm dev:frontend`) and keep the API and sessions in Docker: `docker compose -p berry-dev --profile dev up dev-api dev-sessions`, with `BERRY_API_ORIGIN=http://localhost:4000` as it is in `.env`.
