# Server architecture (`server-ts`)

A map of how the Berry product server is put together, for someone reading it
for the first time. For *what the server does not serve*, see
[`SCOPE.md`](./SCOPE.md); for the route map, see [`ROUTING.md`](./ROUTING.md);
for the public HTTP/SSE contract, see
[`../docs/api/gateway-v1.md`](../docs/api/gateway-v1.md).

## The shape in one paragraph

The server runs its TypeScript sources directly under
`node --experimental-strip-types` — **there is no build step**. A request enters
through a *mount* (one file per `/api/v1` route group), which parses and
validates the request, checks authorization, and calls a *repository* that owns
the SQL for one domain. Repositories talk to Postgres through a single `Sql`
handle. One file, `src/index.ts`, is the **composition root**: the only place
that constructs every repository and wires it into its mount. Nothing else
imports "the whole app," which is why a feature can be added or removed by
touching one mount and one line of the root.

```
HTTP request
   │
   ▼
src/index.ts ── constructs everything once (the composition root)
   │
   ▼
src/http/registry.ts ── refuses overlapping route prefixes, mounts each subtree
   │
   ▼
src/mounts/<feature>.ts ── parse · validate · authorize · serialize   (HTTP entry)
   │
   ▼
src/<domain>/<name>.ts  (a Repository) ── the SQL and rules for one domain  (domain)
   │
   ▼
src/db/pool.ts ── the postgres.js connection and transaction helper       (infra)
```

## The five layers

Every folder under `src/` belongs to one of these. Knowing the layer tells you
what a folder is allowed to do.

- **HTTP entry** — turns a request into a domain call and a domain result into
  the wire response. Never touches SQL directly.
- **Domain** — the product's rules and its SQL, one repository per domain.
  Knows nothing about HTTP.
- **Infrastructure** — cross-cutting plumbing every layer leans on (the HTTP
  framework glue, the database pool, config, logging, realtime fan-out).
- **External integration** — everything that talks to a system outside Berry
  (Bedrock, GitHub, object storage, the agent runtime transport).
- **Dev-script** — run by an operator or CI, not by a request (migrate, seed,
  reset).

## Folder responsibilities

| Folder | Responsibility | Layer |
| --- | --- | --- |
| `mounts/` | One file per `/api/v1` route group: parse, validate, authorize, then call a repository and serialize the result. | HTTP entry |
| `http/` | The framework glue every mount shares: the app shell, the mount `registry`, the error envelope (`errors.ts`), cursor pagination (`cursor.ts`), idempotency (`idempotency.ts`/`idempotent.ts`), canonical JSON (`canonical-json.ts`, the `goJSON`-compatible escaping), body reading. | infrastructure (HTTP) |
| `db/` | `pool.ts`: the postgres.js connection, the `Queryable`/`withinTx` transaction helper, UTC-pinned RFC3339 timestamps. | infrastructure |
| `config/` | `loadConfig()` — the environment parsed into one typed `Config` (note the `boolean` helper; do not use `z.coerce.boolean`). | infrastructure |
| `observability/` | The structured JSON logger and `/metrics` (Prometheus text). | infrastructure |
| `realtime/` | Event fan-out: the in-process `hub`, `replay` from the Postgres outbox, and a `distributed`/`relay` (ioredis/Valkey) path that exists in source but is not wired up. | infrastructure |
| `identity/` | Users, workspaces, memberships, invitations; the `roles` permission matrix; `ScopedDb`/`WorkspaceContext`; the shared `NotFound`/`Forbidden`/`Conflict` errors. | domain (authorization) |
| `auth/` | Sessions, Better Auth wiring, personal-access tokens, dev-login, and the `requireSession` middleware. | domain (security) |
| `core/` | The tracker itself: `boards`, `issues`, `comments`, `dependencies`, `reviews`, `goals`, `projects`, `attachments`. | domain |
| `organization/` | The role catalog, autonomy ceilings, provisioning, discovery and work proposals. See [below](#the-organization). | domain |
| `agents/` | The agent registry: `repository`, model `catalog`, triggers/mentions. Does not itself call a model. | domain |
| `runtime/` | The ADR-0014 control plane: envelope, transport, lifecycle stream, agent-tools API, runtime registrations. See [below](#agent-execution-the-control-plane). | domain + integration |
| `agents/runtime/` | The Strands agent loop that runs *inside* the runtime image (not in this process). Bedrock model client, tools, plugins. Only place Bedrock/Strands imports are allowed (`check:models`). | integration (builds into the runtime image) |
| `runs/` | The run queue and ledger: `queue`, `auto-dispatch`, `scheduler`, and the `dispatcher` that claims a queued run with `SKIP LOCKED` under a renewed lease. | domain |
| `plans/` | The planner: `repository`, `generator`, `triage` (routing), `answers`. | domain + integration |
| `conversations/` | Conversation threads and their model-backed responder. | domain + integration |
| `approvals/` | The approval-gate records, including work-proposal decisions. | domain |
| `inbox/` | Per-user inbox notifications. | domain |
| `editor/` | Model-backed editor assistance. | integration |
| `integrations/` | Sealed provider credentials — connections, the GitHub App manifest flow, OAuth, sealing. **The only place a provider secret is decrypted**, using `INTEGRATION_ENCRYPTION_KEY`. | external integration (security) |
| `scm/` | Source control: the provider interface, GitHub providers, provisioning, sync, inbound webhooks. | external integration |
| `agentcore/` | The AWS Bedrock AgentCore Gateway client and its boot-time tool discovery. | external integration |
| `execution/` | The command-execution driver interface (`http`, `agentcore`, `agentcore-runtime`) used by the runtime container itself to run agent commands. `factory.ts` (which would select a driver by `BERRY_RUNTIME_DRIVER`) is not imported anywhere in the server; the Docker driver in `sandbox/docker/` is not wired into request handling. See [`sandbox/docker/README.md`](./sandbox/docker/README.md). | external integration |
| `storage/` | The S3-compatible object-storage client for agent artifacts. AWS S3 is the default; `S3_ENDPOINT` can point at any S3-compatible store. | external integration |
| `migrate/` | The forward-only migration runner (advisory lock, SHA-256 per file). | dev-script |
| `seed/` | The idempotent development dataset. | dev-script |
| `reset/` | The development/test database reset. | dev-script |

## Following one request: `PATCH /api/v1/issues/{ref}`

1. **`src/index.ts`** has already constructed `new IssueRepository(sql)` and
   passed it into `issueMounts({ issues, boards, ... })`, registered on the
   `Registry`.
2. **`src/http/registry.ts`** mounted that subtree at `/api/v1/issues`, having
   refused at startup any prefix that could overlap another.
3. **`src/mounts/issues.ts`** runs `requireSession`, reads the bounded body,
   resolves the issue by reference, calls `issues.authorize(user, id,
   'product.write')`, validates the patch into `FieldError[]`, then calls
   `issues.update(...)`, publishes the resulting events, and serializes the
   response. Domain errors are translated to the wire envelope here.
4. **`src/core/issues.ts`** — `IssueRepository.update` opens a transaction,
   locks the row `FOR UPDATE`, checks the status transition is legal, writes
   the `UPDATE`, and records outbox events **in the same transaction**.
5. **`src/db/pool.ts`** — the `Sql` handle runs it; the broadcaster publishes
   the already-durable outbox events after the transaction commits (best
   effort — a failed publish costs a live update, never the write).

The layering is the same for every feature: **mount → repository → db**, with
`http/`, `auth/`, and `identity/errors.ts` as the cross-cutting support the
mounts lean on.

## Realtime

`/api/v1/events` serves one SSE stream per board and one per workspace. Both
replay from `outbox_events` in Postgres (`src/realtime/replay.ts`), written in
the same transaction as the underlying change (`src/work/outbox.ts`,
`src/core/*`). The in-process hub (`src/realtime/hub.ts`) fans events out
immediately within one process; the Valkey relay exists in source
(`src/realtime/relay.ts`, `distributed.ts`) but is not wired up in any
environment, so `capabilities.valkey` is always `false` and other processes
learn of an event through the ~500ms poll rather than a push.

## Auth

Sign-in is Better Auth (`/api/auth/*`), GitHub-only, through a dedicated OAuth
App (`BERRY_AUTH_GITHUB_CLIENT_ID`/`_SECRET`), separate from the GitHub App
used for repository access. `POST /api/v1/auth/dev-login` signs in an existing
user by email when `APP_ENV` is explicitly `development` or `test` and
passwordless login is allowed. Personal access tokens (`berry_pat_…`, managed
at `/api/v1/tokens`) and plugin tokens authenticate the `/v1` public API.
`/api/v1/agent-tools` accepts only task-scoped tokens, refused everywhere
else. See [`ROUTING.md`](./ROUTING.md#sign-in) for more detail.

## Integrations

`src/integrations/` seals and unseals provider secrets with
`INTEGRATION_ENCRYPTION_KEY` — without it, integrations and plugins are
disabled. GitHub repository access uses a GitHub App that Berry creates via
the manifest flow (`integrations/github-app.ts`), with per-run installation
tokens; `GITHUB_PROVIDER` selects whether GitHub calls route through the
AgentCore Gateway (`agentcore`, default) or directly (`legacy`).

## Storage

`src/storage/` is enabled once `S3_BUCKET` is set. AWS S3 is the default
target; `S3_ENDPOINT` can point at any S3-compatible store instead.

## Agent execution: the control plane

Berry never calls a model directly from the product server — it is the
control plane, per ADR-0014. The pieces, in the order a task moves through
them:

1. **Trigger and queue** (`src/runs/queue.ts`, `auto-dispatch.ts`,
   `src/agents/triggers.ts`, `mentions.ts`) — a run is queued by assignment,
   mention, chat, autopilot, quick action, agent builder, or completion request
   (the planner's calls).
2. **Dispatcher** (`src/runs/dispatcher.ts`) — claims a queued run with
   `SKIP LOCKED` under a renewed lease and sweeps expired leases. Runs only
   when an executor exists; concurrency is `BERRY_RUN_CONCURRENCY`.
3. **Target selection** (`src/index.ts`) — if `BERRY_AGENTCORE_RUNTIME_ARN` is
   set, the target is the managed AgentCore Runtime; otherwise, if
   `BERRY_AGENT_RUNTIME_URL` is set, the target is the same runtime image
   reached over HTTP. With neither, there is no executor, no dispatcher, no
   scheduler, and `agentExecution` reports `false`. A workspace can register
   its own runtime to override the default per agent (`agent_runtimes` table,
   `src/runtime/runtimes.ts`, mounted at `/api/v1/runtimes`).
4. **Envelope and transport** (`src/runtime/envelope.ts`,
   `envelope-builder.ts`, `transport.ts`, `http-transport.ts`,
   `agentcore-transport.ts`) — builds a `TaskEnvelope` (transcript rebuilt
   from `run_events`, agent skills, MCP servers, plugin env) and sends it via
   `InvokeAgentRuntime` or HTTP. Single model calls (planner, triage, review
   gate, chat, editor) are sent as `kind: 'completion'` tasks rather than full
   agent runs.
5. **Callback URL** — the runtime calls Berry back on
   `BERRY_RUNTIME_CALLBACK_URL` (falling back to `BERRY_PUBLIC_URL`, then the
   bind address), which must be reachable from AWS — a tunnel is needed for
   local development against a deployed runtime.
6. **Lifecycle stream** (`src/runtime/lifecycle.ts`) — the runtime streams
   `task.started | message | usage | completed | failed` back;
   `task-executor.ts` consumes it and `src/runs/ledger.ts` is the only writer
   of run state. Usage is recorded and priced (`usage/record.ts`,
   `PriceBook`).
7. **Agent-tools API** (`src/runtime/agent-tools/`) — the only way the agent
   acts on Berry, at `/api/v1/agent-tools/:name` with a task-scoped bearer
   token (TTL at most 8 hours), never through the database directly. Core
   tools (`set_status`, `read_file`, `list_files`, …) never allow an agent to
   set a task to `done` or `cancelled`; organization tools
   (`delegate_to_agent`, `submit_review`, `propose_work`) are registered
   separately.
8. **The runtime image** (`server-ts/sandbox/agentcore/Dockerfile`) — built
   from `src/agents/runtime/` (the Strands loop, Bedrock model client, tools,
   plugins) plus `src/execution/`, `src/runtime/envelope.ts`,
   `lifecycle.ts` and `src/scm/commit-trailer.ts`. `deploy.sh` builds, pushes
   and publishes it to AWS; it needs account-owner credentials.
   `runtimeSessionId = "berry-" + sha256(agentId:issueId)`.

## The organization

Every workspace is provisioned with an "organization": a protected
Orchestrator agent plus 18 role agents (`src/organization/catalog.ts`,
`CATALOG_VERSION`), each with a mission, a contract, an **autonomy level**
(1–5), delegation and escalation rules, and required reviewers.

- **Autonomy** (`src/organization/autonomy.ts`) is a tool ceiling: the
  effective tool set is the agent's contract `allowed_tools` intersected with
  the level's ceiling. No level includes a merge tool, and agents can never
  set a task to `done` or `cancelled` — release is always a person's
  decision.
- **Delegation and escalation** — `delegate_to_agent`, `mention_agent`, and
  `escalate` (to a role or to a human).
- **Reviews** (`src/organization/reviews.ts`) — required reviewers are
  selected from the author's contract plus labels, changed paths, impact
  class and workflow, with `blocking` or `advisory` authority (for example,
  QA is always blocking; security and architecture are blocking on matching
  labels or paths). `submit_review` (autonomy level 5 only) records a
  blocking review; approval never releases work by itself.
- **Provisioning and discovery** (`src/organization/provision.ts`,
  `discovery.ts`) — idempotent per `role_key`, runs at boot for every
  workspace; a person-edited contract (hash mismatch) is never overwritten.
  Roles with a `discovery` block get a standing task and a weekly cron
  autopilot.
- **Work proposals** (`src/organization/proposals.ts`) — `propose_work`
  creates a labelled, deduplicated task; depending on catalog rules it either
  goes straight to `todo` or waits behind an approval of kind
  `work_proposal`.
- Routes: `/api/v1/organization`, `/api/v1/work-proposals` — see
  [`ROUTING.md`](./ROUTING.md).

## Conventions worth knowing before you edit

- **No build step.** Imports are relative with explicit `.ts` extensions
  (`import { x } from '../core/issues.ts'`). There are **no path aliases and no
  barrel `index.ts` re-exports** on the server — they would need a bundler that
  does not exist here. The only `index.ts` files are the entrypoints
  (`src/index.ts`, `migrate/`, `seed/`, `reset/`).
- **`erasableSyntaxOnly`.** No `enum`, no `namespace`, no TypeScript
  parameter-properties — nothing that emits code. Use `const` maps and union
  types (see `STATUS_TO_DB` in `mounts/issues.ts`).
- **One class per file, named for its role** (`repository.ts`, `ledger.ts`,
  `dispatcher.ts`), with its test co-located as `*.test.ts`.
- **Raw SQL, no ORM.** Repositories use postgres.js tagged templates with
  deliberate concurrency semantics (`FOR UPDATE`, `SKIP LOCKED`, the
  `berry_next_issue_number` function). Timestamps stay strings for wire
  fidelity.
- **The `/api/v1` wire shape is a contract.** The error envelope, cursor
  pagination, `Idempotency-Key`, token shapes and serialized field order must
  keep decoding for clients that already hold them.
- **The composition root wires by hand.** `src/index.ts` constructs everything;
  there is no DI container (decorators/reflection collide with
  `erasableSyntaxOnly` and the no-build rule).
- **No model SDK outside `src/agents/runtime/`.** Enforced by
  `pnpm check:models`.
