# Berry product server

Berry's server, in TypeScript ([ADR-0009](../docs/adr/0009-typescript-product-server.md)).
It is the control plane for a self-hosted, multi-workspace tracker whose
tasks (API and DB: issues) can be assigned to a person or an AI agent. It
imports no model SDK: agent loops run in an AgentCore Runtime container, or
in the same image reached over HTTP (ADR-0014 — see
[`ARCHITECTURE.md`](./ARCHITECTURE.md)).

## What that means for code here

**The wire shape does not change.** `/api/v1`, the error envelope, cursor
pagination, `Idempotency-Key`, Better Auth session cookies and `berry_pat_` personal
access tokens keep their exact shapes.

**This server owns the schema.** `migrations/` is forward-only and immutable,
applied by `src/migrate` under an advisory lock with a SHA-256 per file
recorded in `berry_schema_migrations`. Never edit an applied migration; add a
new one — see [`migrations/README.md`](./migrations/README.md).

**Scope is explicit.** [`SCOPE.md`](./SCOPE.md) lists every prefix the server
serves and what is intentionally not implemented (404 by design).
[`ROUTING.md`](./ROUTING.md) is a grouped reference to the route map plus a
few reference notes worth keeping (GitHub-repository resolver status codes,
sign-in, the JSON-escaping contract, the DB-backed test recipe).

## Running

```
pnpm typecheck:server
pnpm test:server
pnpm dev:server
```

The server runs its `.ts` sources directly under `--experimental-strip-types`,
so there is no build step and nothing that emits code — enums, namespaces,
parameter properties — is allowed. `erasableSyntaxOnly` enforces that.

## Migrations and seed

```
export DATABASE_URL=postgres://<user>@127.0.0.1:5432/berry?sslmode=disable

pnpm migrate:server   # forward-only, idempotent, exits non-zero on checksum drift
pnpm seed:server      # local development dataset, idempotent
```

Run both before starting the server on a fresh database, so it comes up
migrated and with something to log into. There is no container stack — bring
your own PostgreSQL 16+.

## Database-backed tests

Gated on `BERRY_TEST_DATABASE_URL` — without it they skip, so the default
suite stays offline. See
[`ROUTING.md`](./ROUTING.md#database-backed-tests) for the exact recipe
(`berry_test`, `C` collation, schema-only copy).

## Key environment variables

The full list is in `src/config/config.ts`; grouped here by purpose (never
commit values):

- **Core**: `DATABASE_URL` (required), `API_ADDR`, `APP_ENV`, `SESSION_TTL`.
- **Auth**: `BERRY_AUTH_SECRET`, `BERRY_AUTH_GITHUB_CLIENT_ID` /
  `BERRY_AUTH_GITHUB_CLIENT_SECRET` (sign-in OAuth App), `BERRY_APP_URL`,
  `BERRY_PUBLIC_URL`, `AUTH_ALLOW_PASSWORDLESS_LOGIN`.
- **Integrations**: `INTEGRATION_ENCRYPTION_KEY` (integrations and plugins
  are off without it), `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` (legacy
  repository connection), `GITHUB_PROVIDER`, `BERRY_GITHUB_WEBHOOK_SECRET`.
- **Storage**: `S3_BUCKET` (enables storage), `S3_REGION`, `S3_ENDPOINT`,
  `S3_USE_PATH_STYLE`, `AWS_ACCESS_KEY_ID` / `AWS_SECRET_ACCESS_KEY` /
  `AWS_SESSION_TOKEN`, `STORAGE_MAX_BYTES`. AWS S3 is the default; any
  S3-compatible endpoint works via `S3_ENDPOINT`.
- **Agents / Bedrock**: `BERRY_BEDROCK_REGION` (or `AWS_REGION`),
  `BERRY_BEDROCK_*` credentials, `BERRY_AGENT_DEFAULT_MODEL`,
  `BERRY_RUN_CONCURRENCY`.
- **Runtime (ADR-0014)**: `BERRY_AGENT_RUNTIME_URL` (HTTP fallback target),
  `BERRY_AGENTCORE_RUNTIME_ARN` (managed target), `BERRY_AGENTCORE_REGION`,
  `BERRY_RUNTIME_CALLBACK_URL` (must be reachable from AWS), `BERRY_TASK_TOKEN_TTL_SECONDS`.

See [`ARCHITECTURE.md`](./ARCHITECTURE.md#agent-execution-the-control-plane)
for how these combine to select an executor, and `GET /api/v1/config` for
what capabilities a running process actually reports.

## Links

- [`ARCHITECTURE.md`](./ARCHITECTURE.md) — server structure
- [`ROUTING.md`](./ROUTING.md) — route map and reference notes
- [`SCOPE.md`](./SCOPE.md) — what is intentionally not served
- [`migrations/README.md`](./migrations/README.md) — migration rules
- [`../docs/api/gateway-v1.md`](../docs/api/gateway-v1.md) — public HTTP/SSE contract
- [`../packages/plugin-sdk/README.md`](../packages/plugin-sdk/README.md) — plugin SDK
