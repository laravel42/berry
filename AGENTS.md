# Repository Guidelines

Guidance for AI agents working in this repository.

> **Single source of truth:** this file is the short pointer. Authoritative
> write-ups live in `docs/`. Read the doc that matches the work before editing.
> Use each workspace's manifest and build documentation as the source of truth
> for commands.

| If you are… | Read first |
| --- | --- |
| Changing product scope or motion | [`docs/product-brief.md`](docs/product-brief.md) |
| Writing code, tests, commits, or PRs | [`docs/coding-playbook.md`](docs/coding-playbook.md) |
| Touching the public HTTP/SSE contract | [`docs/api/gateway-v1.md`](docs/api/gateway-v1.md) |
| Working on the server at all | [`server-ts/SCOPE.md`](server-ts/SCOPE.md), [`server-ts/ROUTING.md`](server-ts/ROUTING.md), [`server-ts/ARCHITECTURE.md`](server-ts/ARCHITECTURE.md) |
| Changing the stack or the schema | [`docs/adr/`](docs/adr/) |
| Changing UI tokens or visual language | [`docs/design-system.md`](docs/design-system.md) |
| Working on the frontend at all | [`frontend/ARCHITECTURE.md`](frontend/ARCHITECTURE.md) |
| Shipping a notable change | [`docs/changelog-process.md`](docs/changelog-process.md) |

## What Berry is

Berry is a self-hosted, multi-workspace product where humans and AI coding
agents plan, execute, and review work together. Berry owns the product, its
durable state, and the dispatch of agent work: agents run in an AgentCore
Runtime container (or the same image reached over HTTP) on the Strands Agents
SDK, and Berry is the control plane
([ADR-0014](docs/adr/0014-agentcore-runtime-control-plane.md), which
supersedes the in-process runtime of
[ADR-0013](docs/adr/0013-strands-native-agent-runtime.md) and the earlier
Google ADK design of ADR-0008). The server process imports no model SDK;
`scripts/check-no-model-in-server.py` enforces it.

Core loop: issue → assign to a human or agent → work on the issue → human
review gate → done. Every workspace is provisioned with a small organization
of role agents (an Orchestrator plus product, engineering, quality, platform,
growth and leadership roles) with their own contracts, autonomy levels,
delegation rules and required reviewers — see
[`server-ts/src/organization/`](server-ts/src/organization/) and
[PRODUCT.md](PRODUCT.md).

## Repository shape

One Git repo, three pnpm workspaces. They do **not** share a formatter, lint
config, or validation workflow. Know which workspace you are in before you
write code. Never run one workspace's tools over another.

| | `server-ts/` | `frontend/` | `packages/plugin-sdk/` |
| --- | --- | --- | --- |
| Role | Product server, migrations, agent runtime | Next.js App Router UI | Plugin SDK |
| Package | `@berry/server` | `berry-frontend` | `@berry/plugin-sdk` |
| Paths | relative, `.ts` extensions kept | `@/*` → frontend root | relative, `.ts` extensions kept |
| Format + lint | none configured; match surrounding style | Prettier **3-space**, single quotes + ESLint | match server |
| Tests | `node --test` | none — lint + build | `node --test` |
| Validation | Zod v4 | Zod v4 (`package.json` pins `^4.6.5`) | — |

Also in the repo: `docs/` and `scripts/` (Python repository checks). There is
no container stack: Berry runs on the host against its own PostgreSQL 16, AWS
S3 (or an S3-compatible store) and AgentCore Runtime.

The server runs its `.ts` sources directly under `--experimental-strip-types`.
There is no build step, so nothing that emits code — enums, namespaces,
parameter properties — is allowed; `erasableSyntaxOnly` enforces it.

## Hard boundaries

- **Browsers call Berry only.** Never send a provider credential to a client,
  log it, persist it in product rows, or call a model provider from the
  frontend. `NEXT_PUBLIC_*` is the browser bundle: nothing secret may use that
  prefix.
- **Provider secrets are sealed, in one place.** Connection tokens and the
  GitHub App's private key are encrypted with `INTEGRATION_ENCRYPTION_KEY` and
  opened only in `src/integrations/`. That key is the one credential that must
  stay in the environment — it is what everything else is encrypted with, so
  it cannot live in the database it protects. A deployment without it holds no
  provider credential at all rather than holding one in the clear.
- **Berry owns product state.** Postgres is authoritative for users, sessions,
  boards, issues, assignments, comments, review decisions, and the run ledger.
  The realtime hub replays from `outbox_events` in Postgres; there is no
  wired message relay, so events reach other processes on the ~500 ms poll
  rather than instantly.
- **Migrations are forward-only and immutable.** `server-ts/migrations/` is
  applied by `src/migrate` under an advisory lock, and the ledger stores a
  SHA-256 per file. Never edit an applied migration; add a new one. The runner
  exits non-zero on checksum or name drift rather than migrating over it.
- **The wire shape is a contract.** `/api/v1`, the error envelope, cursor
  pagination, `Idempotency-Key` and `berry_pat_` tokens keep their exact shapes;
  browser sessions are Better Auth cookies (GitHub is the only sign-in method).
  Cursors and idempotency fingerprints already issued must keep decoding, so
  the canonical JSON form and the cursor envelope are not free to change.
- **Agents don't release their own work.** No autonomy level grants a merge
  tool, and the `set_status` tool never allows `done` or `cancelled`
  (`server-ts/src/runtime/agent-tools/core-tools.ts`). A reviewer agent's
  approval never releases work either — a person accepts the release.
- **Licenses.** Shipped dependencies must be MIT / Apache-2.0 (or equivalently
  permissive). Retain Circle MIT notices. Do not copy another product's schema,
  brand, or marks. Do not use "Linear" as Berry product branding or in new code
  identifiers. Existing Circle comments that say "Linear-style" are legacy — do
  not spread that into new APIs.
- **TypeScript `strict` stays on. No `any`.** Narrow instead of `!`. The only
  `any` exemption is vendored `frontend/components/data-table-filter/**`.

## Current implementation (do not invent the missing layer)

**The server is incomplete on purpose.** Read
[`server-ts/SCOPE.md`](server-ts/SCOPE.md) before assuming a prefix is missing
by accident — it lists what is deliberately unserved (404 by design).

**Runs are tasks the server hands to a runtime.** `POST /api/v1/issues/{ref}/runs`
(or any other trigger — auto-dispatch, an autopilot, a mention, chat, a quick
action, the agent builder, or a completion request such as the planner's calls)
queues a task; `runs/dispatcher.ts` claims it with
`SKIP LOCKED`, holds a lease it renews, and sweeps runs whose lease expired.
The claimed task is built into a task envelope and sent to the runtime with
`InvokeAgentRuntime` (or, with `BERRY_AGENT_RUNTIME_URL`, to the same image
served over HTTP). The runtime's lifecycle stream is written to the run ledger.
The runtime calls Berry's tools back at `/api/v1/agent-tools` with a
task-scoped token. There is no other external worker.

**The organization gates and routes agent work.** Each role agent has a
contract (mission, allowed tools, delegation and escalation targets, required
reviewers) and an autonomy level from 1–5 that ceilings its effective tools
regardless of what the contract allows. `qa-engineer` review is always
blocking; `security-engineer` and `software-architect` reviews are blocking
when their labels or paths are touched. Agents can `propose_work` and
`delegate_to_agent`, and escalate to a role or to a human — but never to
`done`, and never through a merge tool.

**GitHub is an App Berry creates, not a credential it is given.** The manifest
flow posts what the App may do, and the conversion returns the id, both halves
of the OAuth credential, the private key and the webhook secret at once — which
is also what registers the callback URLs, so a `redirect_uri` mismatch is not a
failure mode. Repository work runs on installation tokens minted per run
(`src/integrations/github-app.ts`); the older user-token connection remains only
as a fallback for a deployment with no App, and is never preferred when one
exists.

**`GET /api/v1/config` is how the browser learns what works.** It reports only
capabilities this process actually has — for example, `agentExecution` is true
only when a runtime target (an AgentCore ARN or `BERRY_AGENT_RUNTIME_URL`) is
configured, not merely when a model credential exists. A capability reported
true that the server cannot deliver is worse than one reported false.

**Frontend is wired to the API** through `lib/api.ts` (`apiUrl` / `apiFetch`).
Do not reintroduce demo/mock datasets. `NEXT_PUBLIC_BERRY_API_URL` empty means
same-origin through the Next.js rewrites, which is the normal case.

**Removed, do not re-add:** squads/Crew (a team module with a client-side
roster); the Google ADK in-process runtime; OpenRouter; Docker Compose. Their
replacements are, respectively, the organization above, ADR-0014's AgentCore
Runtime, Bedrock, and host-run PostgreSQL/S3/AgentCore.

**Descriptions are plain-text fields.** A rich editor round-tripped markdown
through parse/serialize, which rewrote untouched content — bullet markers,
blank lines, and `web_search` escaped to `web\_search` — including agent
system prompts. `DescriptionTextarea` saves the exact bytes it was given.

Schema notes that can bite you:

- Allocate `issues.number` via atomic `boards.issue_counter` in the same
  transaction — never `MAX(number)+1`.
- `assignee_type` / `assignee_id` are both-or-neither.
- Validate `boards.columns` with Zod on every write (DB only checks JSON array).
- Same-issue comment threading is not DB-enforced; validate on the write path.
- Storage names are not API field names (`camelCase` over the wire).
- An agent's `role_key`, `role_contract`, `contract_version`, `contract_hash`
  and `autonomy_level` come from the organization catalog; a person-edited
  contract (hash mismatch) is never silently overwritten by provisioning.

Do not port a legacy feature that Berry has replaced or excluded;
`server-ts/SCOPE.md` and the product brief's "Current web platform" section
record what is in scope.

## Commands

```bash
# Setup (from repo root; needs your own PostgreSQL 16)
cp .env.example .env && pnpm install

# Repository checks
python3 scripts/check-no-model-in-server.py
python3 scripts/check-locale-catalogues.py

# Server
pnpm typecheck:server
pnpm test:server
pnpm migrate:server         # needs DATABASE_URL
pnpm seed:server            # development dataset; idempotent
pnpm dev:server

# Plugin SDK
pnpm test:plugin-sdk && pnpm typecheck:plugin-sdk

# Frontend
cd frontend && pnpm lint && pnpm build:check
```

`pnpm build` in `frontend/` and `next dev` share `.next/`, so a build while the
dev server runs corrupts its manifests. Use `pnpm build:check`, which writes to
`.next-verify` instead.

Database-backed server tests self-skip when `BERRY_TEST_DATABASE_URL` is unset,
so a fresh `pnpm test:server` stays green offline. Keep it that way. Never
point it at your everyday development database: creating a workspace
provisions a protected Orchestrator agent that cannot be deleted.

## Commits, branches, review

```
type(scope): imperative summary (BERR-NN)
```

- Scopes: `server-ts`, `frontend`, or omit for docs-only.
- One issue per branch and PR.

Definition of done: server typecheck and tests; frontend lint + `build:check`
and a manual check of the changed view. No secrets or `.env` files.

## Domain reminders

- Assignees are polymorphic: `user | agent`.
- Issue statuses: `backlog → todo → in_progress → in_review → done`
  (`blocked` and `cancelled` also exist). The release gate is always human;
  no agent tool can set `done` or `cancelled`.
- Public API: `/api/v1`, cursor pagination, `Idempotency-Key` on creating
  POSTs, stable `SCREAMING_SNAKE_CASE` error codes.
- Env booleans: do not use `z.coerce.boolean()` (`"false"` becomes `true`).
  Follow the `boolean` helper in `server-ts/src/config/config.ts`.
- Workspace issue prefixes default to the first three letters/digits of the
  workspace name (server-derived, editable as `settings.issuePrefix`); tracker
  issues are `BERR-NN`.
  Do not conflate them.
- Prefer semantic design tokens (`status-*`, `actor-*`, `review-*` in
  `app/globals.css`) over raw palette utilities.
- Native inputs need `--foreground` and `-webkit-text-fill-color`. Fading
  placeholders with low-opacity `muted-foreground` reads as black on void.
