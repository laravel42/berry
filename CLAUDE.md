# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

Berry is a self-hosted, multi-workspace issue tracker whose assignees can be people or AI agents. Core loop: issue → assign (user | agent) → run → human review gate → done.

**Read [AGENTS.md](AGENTS.md) first.** It is the authoritative short guide: hard boundaries, schema gotchas, domain rules, commit conventions. It links to the doc that matches the work (`docs/coding-playbook.md`, `docs/api/gateway-v1.md`, `docs/adr/`, `server-ts/SCOPE.md`, `server-ts/ROUTING.md`, `server-ts/ARCHITECTURE.md`, `frontend/ARCHITECTURE.md`). This file only adds what you need to get oriented quickly.

## Workspaces (pnpm, three packages, no shared toolchain)

| | `server-ts/` (`@berry/server`) | `frontend/` (`berry-frontend`) | `packages/plugin-sdk/` (`@berry/plugin-sdk`) |
| --- | --- | --- | --- |
| Runtime | Node, `--experimental-strip-types`, **no build step** | Next.js 15 App Router, React 19 | Node, strip-types |
| Imports | relative with `.ts` extension; no aliases, no barrels | `@/*` → `frontend/` | relative `.ts` |
| Style | no formatter; match surroundings (3-space, single quotes) | Prettier 3-space + ESLint | match server |
| Tests | `node --test` | none — lint + build | `node --test` |
| Zod | v4 | **v3** | — |

Never run one workspace's formatter or linter over another. The server enables `erasableSyntaxOnly`, `verbatimModuleSyntax` and `noUncheckedIndexedAccess`. That rules out enums, namespaces and parameter properties, and requires `import type` for type-only imports.

## Commands (from repo root unless noted)

```bash
cp .env.example .env && pnpm install   # no container stack: bring your own PostgreSQL 16

pnpm typecheck:server
pnpm test:server                 # DB tests self-skip without BERRY_TEST_DATABASE_URL
pnpm dev:server                  # node --watch, reads ../.env
pnpm migrate:server              # needs DATABASE_URL
pnpm seed:server                 # idempotent dev dataset
pnpm reset:server                # development/test database reset

# single server test file / single test
cd server-ts && node --test --experimental-strip-types src/runs/dispatcher.test.ts
cd server-ts && node --test --experimental-strip-types --test-name-pattern='lease' src/runs/dispatcher.test.ts

pnpm test:plugin-sdk && pnpm typecheck:plugin-sdk

pnpm dev:frontend
cd frontend && pnpm lint && pnpm build:check   # build:check writes .next-verify; plain `build` corrupts a running `next dev`

# repository checks (Python)
python3 scripts/check-locale-catalogues.py     # English catalogues well-formed; no extra locales
pnpm check:models                              # no model SDK imports in server-ts/src outside agents/runtime/
```

To run DB-backed tests, create a schema-only copy of the dev database and point `BERRY_TEST_DATABASE_URL` at it. `server-ts/ROUTING.md` gives the exact commands. Never use the dev database: creating a workspace provisions a protected Orchestrator agent that can't be deleted.

## Server architecture (big picture)

**Request path:** `src/index.ts` is the composition root. It is the only file that constructs every repository and wires dependencies by hand; there is no DI container. `src/http/registry.ts` mounts route subtrees and refuses overlapping prefixes at startup. Each `src/mounts/<feature>.ts` parses, validates, authorizes (`requireSession`, `authorize(user, id, 'product.write')`) and serializes. A domain repository such as `src/core/issues.ts` owns raw postgres.js SQL, with deliberate locking (`FOR UPDATE`, `SKIP LOCKED`). It writes `outbox_events` in the same transaction, and they are published after commit. `src/http/` holds the error envelope, cursor pagination, idempotency and canonical JSON (`goJSON` escaping). These are byte-level contracts. `src/index.ts` is the source of truth for which prefixes are served. `SCOPE.md` lists what is intentionally unserved (404 by design, not a bug).

**Realtime:** `/api/v1/events` (one SSE stream per board and one per workspace) replays from `outbox_events` in Postgres. The Valkey relay exists in code but is not wired anywhere, so events always arrive on the ~500 ms poll rather than instantly.

**Agent runs (ADR-0014, the current design):** Berry is the control plane and imports no model SDK.
1. A trigger such as `POST /api/v1/issues/{ref}/runs`, auto-dispatch or an autopilot queues a task.
2. `src/runs/dispatcher.ts` claims it with `SKIP LOCKED` under a renewed lease and sweeps expired leases.
3. The dispatcher builds a `TaskEnvelope` and sends it via `InvokeAgentRuntime` (`src/runtime/agentcore-transport.ts`). With only `BERRY_AGENT_RUNTIME_URL` set, it goes over HTTP to the same image instead.
4. The runtime streams `LifecycleEvent`s back (`task.started|message|usage|completed|failed`). `src/runs/ledger.ts` is the only writer of run state.
5. The Strands loop runs inside the runtime image, built from `server-ts/sandbox/agentcore/Dockerfile` using the sources in `src/agents/runtime/`. Models are Bedrock inference profiles (for example `us.anthropic.claude-haiku-4-5-20251001-v1:0`), not bare model ids.
6. The agent acts on Berry only through `/api/v1/agent-tools/*` with a task-scoped token, never through the database.
7. Single model calls (planner, triage, review gate, chat, editor) are `kind: 'completion'` tasks.
8. `runtimeSessionId = "berry-" + sha256(agentId:issueId)`. The envelope always carries a transcript rebuilt from `run_events`, so cold restores work.
9. `sandbox/agentcore/deploy.sh` pushes and publishes the runtime image to AWS. It needs account-owner credentials. The runtime calls Berry back on `BERRY_RUNTIME_CALLBACK_URL` (or `BERRY_PUBLIC_URL`), which AWS must be able to reach.

**Other key areas:**
- `src/integrations/` is the only place sealed provider secrets are decrypted, using `INTEGRATION_ENCRYPTION_KEY`.
- GitHub repository access uses a GitHub App that Berry creates via the manifest flow (`integrations/github-app.ts`), with per-run installation tokens.
- Sign-in is Better Auth at `/api/auth/*` with GitHub only, through a separate OAuth App.
- `/v1` is the public API for PATs and plugin tokens, backed by `src/public-api/` and `packages/plugin-sdk`.
- Artifacts go to S3 via `src/storage/`. The default is AWS S3; `S3_ENDPOINT` can point at any S3-compatible store.
- `GET /api/v1/config` must report only capabilities the process actually has. For example, `agentExecution` is true only when an agent runtime target is configured (an AgentCore ARN or `BERRY_AGENT_RUNTIME_URL`) — not merely because a model credential exists.
- Every workspace gets an organization: the Orchestrator plus 18 role agents (`src/organization/`), each with a contract, an autonomy level (1–5) that ceilings its tools, delegation/escalation rules and required reviewers. No autonomy level includes a merge tool, and `set_status` never allows `done` or `cancelled` — release is always a human decision.

**Migrations:** `server-ts/migrations/` are forward-only and SHA-256 checksummed by `src/migrate`. Never edit an applied migration; add a new numbered one.

## Frontend architecture (big picture)

The request path is `app/[orgId]/…` route → `components/` → `lib/<domain>.ts` → `lib/api.ts` (`apiFetch`, the only way to reach the server) → a same-origin `/api/*` call, proxied by `next.config.ts` to `BERRY_API_ORIGIN`.
- Shared collection state lives in Zustand stores (`store/`), typed by `data/`. `data/` holds domain types, fixed vocabularies and pure helpers; stores start empty and fill from the API. No demo datasets.
- One-shot calls go straight to `lib/`.
- Realtime subscriptions live in `hooks/`.
- i18n uses next-intl with catalogues in `messages/en`. English is the only shipped language.
- Descriptions are plain textareas, saved byte-exact.
- Use semantic tokens from `app/globals.css` (see `docs/design-system.md`).

## Stale docs to be aware of

Code comments, `.env.example` and some historical records still describe the older design:
- Docker Compose was removed. Code comments that mention "Compose" (for example in `src/config/config.ts` and `src/config/config.test.ts`) describe how env values used to arrive.
- `.env.example` still lists variables nothing reads: `BERRY_OPENROUTER_API_KEY`, `BERRY_INTERNAL_TOKEN` and `BERRY_API_PORT`.
- `BERRY_RUNTIME_DRIVER` is parsed in `src/config/config.ts`, but the Docker execution driver is not wired: `src/execution/factory.ts` is imported nowhere, and `src/index.ts` picks a runtime target only from the AgentCore ARN or `BERRY_AGENT_RUNTIME_URL` (see `server-ts/sandbox/docker/README.md`).
- The dated plans and specs in `docs/superpowers/`, `CHANGELOG.md` and the Context/Decision/Consequences bodies of ADRs are history. Each ADR's Status line and "Current state" section say what holds today.
- Squads/Crew, the Google ADK runtime and OpenRouter are gone; do not re-add them.

When a doc conflicts with ADR-0014, `AGENTS.md`, `server-ts/SCOPE.md` or `src/index.ts`, trust the latter.

## Commits

`type(scope): imperative summary (BERR-NN)`. Use `server-ts` or `frontend` as the scope, or omit it for docs-only changes. One issue per branch and PR.
