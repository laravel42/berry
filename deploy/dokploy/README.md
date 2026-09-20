# Berry on Dokploy

One Compose service, built on the Dokploy server from this repository: PostgreSQL, the API, the web app and the agent session router. Written for a server on a private network (`192.168.0.100`) published through a Cloudflare tunnel at `dev.berry.pm`.

```
browser ─ HTTPS ─ Cloudflare ═ tunnel ═ Traefik :80 ─┬─ dev.berry.pm ────── web :3000 ─ /api, /v1 ─┐
                                                     └─ p-….berry.pm ─────────────────────────────── api :4000
                                                            sessions :8080 ← api              postgres :5432
```

Cloudflare ends TLS and the tunnel speaks plain HTTP to Traefik, so the server needs no certificate and no open port. Berry is told its public scheme is `https` (`BERRY_SCHEME`), which is what it puts in links, callbacks and preview addresses.

The API starts a preview's containers, and the session router starts one container per agent run, both through the server's Docker socket. Those are siblings of Berry's containers, so they are published on the Docker bridge address (`172.17.0.1`, reachable from containers and the server itself, not from the network) and reached as `host.docker.internal`.

## The tunnel

In Cloudflare Zero Trust → Networks → Tunnels → your tunnel → Public hostnames, two entries, both to Traefik:

| Public hostname | Service |
| --- | --- |
| `dev.berry.pm` | `http://localhost:80` |
| `*.berry.pm` | `http://localhost:80` |

Use `http://dokploy-traefik:80` instead when `cloudflared` runs as a container on `dokploy-network`. The wildcard entry does not create its DNS record: add a proxied `CNAME` named `*` pointing at `<tunnel id>.cfargotunnel.com`. Hostnames with their own record (`berry.pm`, `www`, `local`) keep going where they go today; the wildcard only catches names that have none, and Traefik answers 404 for any that is not a preview.

## Preview hostnames

A preview answers at `p-<id>-<app>.<preview domain>`, a different host per preview. Cloudflare's free certificate covers `berry.pm` and `*.berry.pm`: one level. `p-….preview.dev.berry.pm` is three levels down and browsers would refuse it. So:

- **Free:** `BERRY_PREVIEW_DOMAIN=berry.pm`, previews at `p-….berry.pm`. This is what `.env.example` sets. The cost: a preview runs a pull request's code on a sibling host of your real sites, and a page there can set a cookie for `.berry.pm` that those sites then receive. Berry itself strips its own cookies from preview traffic and never sends them to one. Acceptable for your own repositories; not for untrusted ones.
- **Isolated:** a separate cheap domain for previews on the same tunnel (`BERRY_PREVIEW_DOMAIN=berry-previews.dev`, wildcard `*.berry-previews.dev`), or Cloudflare Advanced Certificate Manager for `*.preview.dev.berry.pm`.

## Install

1. **Server:** needs about 6 GB of free memory for the first build (the web app's build is the heavy part) and 20 GB of disk. Then, once:
   ```bash
   sudo mkdir -p /var/lib/berry/previews
   ip -4 addr show docker0        # expect 172.17.0.1; if not, set DOCKER_BRIDGE_ADDR to what it says
   ```
   If the server runs a firewall (ufw), allow the Docker networks to reach the bridge address: `sudo ufw allow from 172.16.0.0/12 to 172.17.0.1`.
2. **Dokploy:** Project → Create Service → **Compose**. Provider: this Git repository and branch. Compose path: `deploy/dokploy/docker-compose.yml`.
3. **Environment tab:** paste `.env.example` from this folder and fill it in. Generate the four secrets with `openssl rand -base64 32` (`openssl rand -hex 24` for the database password). Keep `INTEGRATION_ENCRYPTION_KEY` somewhere safe: it seals every stored credential and build variable.
4. **Domains tab:** add `dev.berry.pm` → service `web`, port `3000`, HTTPS **off** (Cloudflare holds the certificate; turning it on makes Traefik redirect the tunnel's HTTP in a loop). The preview route is already in the compose file, because it is a pattern and the Domains tab takes one host.
5. **Deploy.** The first deploy builds three images and takes 10 to 15 minutes. Migrations run when the API starts.
6. **Sign-in:** create a GitHub OAuth App with callback `https://dev.berry.pm/api/auth/callback/github`, put its id and secret in the Environment tab, deploy again.

Check it: `https://dev.berry.pm/ready` answers `200`.

## Things to know behind the tunnel

- **GitHub webhooks work**, since `dev.berry.pm` is public: set `BERRY_GITHUB_WEBHOOK_SECRET` to enable the inbound route.
- **Long requests:** Cloudflare drops a response that stays silent for 100 seconds. Berry's event stream and the build terminal write continuously, so they hold. A single preview page that takes longer than that to answer will show Cloudflare's 524.
- **Agent sessions call the API back** at `https://dev.berry.pm`, out through Cloudflare and in again. It works and costs a few milliseconds per tool call. To keep it on the machine, set `BERRY_RUNTIME_CALLBACK_URL` to an address the session containers can reach directly.
- **Cloudflare Access:** if you put Access in front of `dev.berry.pm`, exempt `/api/auth/callback/*`, `/api/v1/agent-tools/*` and the webhook path, or GitHub and the agent sessions are asked to log in. Do not put Access in front of preview hosts that agents' tests need to reach.
- **Bedrock** is reached outward with an AWS key that may invoke models (`BERRY_BEDROCK_*`). Without it Berry runs, and agents do not.

## Without the tunnel

On the private network alone, no DNS is needed: `BERRY_SCHEME=http`, `BERRY_DOMAIN=berry.192.168.0.100.sslip.io`, `BERRY_PREVIEW_DOMAIN=preview.192.168.0.100.sslip.io` (and its escaped form). Every name under `192.168.0.100.sslip.io` resolves to the server. If they do not resolve, the router is filtering private addresses out of DNS answers ("DNS rebind protection"); exempt `sslip.io` there. GitHub webhooks cannot reach a private address.

When Traefik itself must serve HTTPS (a public server with no tunnel): turn HTTPS on in the Domains tab, and in `docker-compose.yml` change the preview router's entrypoint to `websecure` and uncomment its two `tls` lines. Preview hosts are a wildcard, which Let's Encrypt issues only by DNS challenge, so that resolver has to be added to Dokploy's Traefik first.

## Operating it

- **Update:** push, then Deploy (or turn on Auto Deploy). Only changed images rebuild.
- **Logs:** the service's Logs tab, per container (`api`, `web`, `sessions`, `postgres`).
- **Backup:** the database is the `berry-postgres` volume. `docker exec <postgres container> pg_dump -U berry berry > berry.sql`, or a Dokploy volume backup.
- **`runtime-image` shows as exited:** intended. It only exists so a deploy builds the image agent sessions start from.
- Previews and agent sessions appear in `docker ps` as `berry-pv-…` and `berry-rt-…`. They are Berry's, started and stopped by it; Dokploy does not list them.

## Security

The API and the session router hold the server's Docker socket, which is root on that machine: run Berry on a server you would give it. Previews run a pull request's code in containers with no capabilities, memory, CPU and process limits; agent sessions are isolated from each other the same way. Neither gets the socket.
