# Berry

Berry is a self-hosted, multi-workspace issue tracker whose assignees can be people or
AI agents. The core loop is: an issue is created, assigned to a person or an agent, the
agent runs and posts progress, and a person reviews and accepts the result before it is
done. Berry is the control plane for that loop — it owns workspaces, issues, comments,
reviews and the run ledger — and it never imports a model SDK itself
([ADR-0014](docs/adr/0014-agentcore-runtime-control-plane.md)).

Every workspace is provisioned with a small organization of role agents (product,
engineering, quality, platform, growth and leadership roles, plus an Orchestrator) with
their own contracts, autonomy levels and review rules. Agents can plan, implement and
propose work, but they cannot mark an issue done or merge anything — release is always a
human decision. See [PRODUCT.md](PRODUCT.md) for the product-level description.

| Path | What |
| --- | --- |
| `server-ts` | TypeScript product server, its migrations, and the agent runtime sources |
| `frontend` | Next.js App Router UI |
| `packages/plugin-sdk` | SDK for building Berry plugins |
| `docs` | Product brief, ADRs, API contract, design system |

The three packages are a pnpm workspace and do not share a toolchain (different
formatters, linters and even Zod major versions) — see [AGENTS.md](AGENTS.md) for the
per-package rules.

## What the server serves

The server serves identity, workspaces, boards, issues, comments, dependencies, reviews,
goals, projects, attachments, agents, the organization, work proposals, runs, runtimes,
integrations, approvals, the inbox, conversations, search, saved views, catalogs, plans,
autopilots, skills, MCP servers, plugins, usage and dashboards, editor AI, the task-token
agent-tools API, the public `/v1` API, and the realtime event streams. `GET /api/v1/config`
reports only the capabilities this deployment actually has (for example, `agentExecution`
is only true when an agent runtime target is configured), so the UI switches off what is
missing rather than offering it. `server-ts/SCOPE.md` records what is deliberately left
unserved.

## What Berry needs

Berry runs on the host; there is no container stack in this repository.

| Dependency | Purpose |
| --- | --- |
| PostgreSQL 16 | Berry's durable product state, reached through `DATABASE_URL` |
| AWS S3 (or an S3-compatible store) | Artifact storage, through the `S3_*` variables |
| AWS Bedrock AgentCore Runtime | Where agents run ([ADR-0014](docs/adr/0014-agentcore-runtime-control-plane.md)) |

Provider keys and object-store credentials are server-side only, never under a
`NEXT_PUBLIC_*` name.

## Quick start

Prerequisites: Node 22 (with `--experimental-strip-types`), pnpm 10 (via corepack), a
PostgreSQL 16 instance you run yourself, and Python 3 for repository checks.

```sh
cp .env.example .env
pnpm install
```

```sh
pnpm migrate:server   # forward-only, under an advisory lock; reads DATABASE_URL
pnpm seed:server      # idempotent development dataset
pnpm dev:server       # http://127.0.0.1:4000
```

```sh
cd frontend && cp .env.example .env.local && cd ..
pnpm dev:frontend     # http://127.0.0.1:3000
```

Check the server is up:

```sh
curl http://127.0.0.1:4000/health
curl http://127.0.0.1:4000/ready
curl http://127.0.0.1:4000/api/v1/config
```

With `APP_ENV=development` and `AUTH_ALLOW_PASSWORDLESS_LOGIN` (default on),
`POST /api/v1/auth/dev-login` signs in an existing user by email without GitHub. For
real sign-in, configure a GitHub OAuth App (`BERRY_AUTH_GITHUB_CLIENT_ID/SECRET`).

Run the checks:

```sh
pnpm typecheck:server
pnpm test:server            # DB-backed tests self-skip without BERRY_TEST_DATABASE_URL
pnpm test:plugin-sdk && pnpm typecheck:plugin-sdk
cd frontend && pnpm lint && pnpm build:check   # build:check writes .next-verify, not .next
```

Never point any of this at your everyday development database: creating a workspace
provisions a protected Orchestrator agent that cannot be deleted, so a schema-only copy
is the right target for `BERRY_TEST_DATABASE_URL`. See `server-ts/ROUTING.md`.

## How agent execution works

Berry queues a task (from an assignment, a mention, chat, an autopilot, a quick action, the
agent builder, or a completion request such as the planner's calls), a dispatcher claims it under a lease, and the task is sent as a
`TaskEnvelope` to an agent runtime — either an AWS Bedrock AgentCore Runtime, or the same
runtime image reached over plain HTTP. Inside that runtime, a Strands Agents SDK loop
calls Bedrock models and streams lifecycle events (`task.started`, `task.message`,
`task.usage`, `task.completed`, `task.failed`) back to Berry, which is the only writer of
run state. The agent acts on Berry exclusively through `/api/v1/agent-tools/*` with a
short-lived, task-scoped token — never through the database directly.

To run agents yourself, you need:

- AWS credentials for Bedrock and AgentCore — either a `BERRY_BEDROCK_*` /
  `BERRY_AGENTCORE_*` key pair, or the default AWS credential chain, plus a region.
- A deployed runtime image. `server-ts/sandbox/agentcore/deploy.sh` builds it, pushes it
  to ECR and publishes it as an AgentCore Runtime; it needs account-owner AWS credentials
  and Docker buildx on the machine running it. Point `BERRY_AGENTCORE_RUNTIME_ARN` at the
  ARN it prints. (Alternatively, set `BERRY_AGENT_RUNTIME_URL` to call the same image over
  HTTP without AgentCore.)
- A public callback URL: the runtime calls Berry back on `BERRY_RUNTIME_CALLBACK_URL` (or
  `BERRY_PUBLIC_URL`), which AWS must be able to reach — a tunnel when developing locally.
- `S3_BUCKET` so a run's files have somewhere to land, and `INTEGRATION_ENCRYPTION_KEY`
  if the run needs GitHub or plugin credentials.

Without a runtime target, `agentExecution` reports `false` in `GET /api/v1/config` and
the dispatcher, scheduler and review gate simply do not start — the rest of Berry works
normally.

## Documentation

- [AGENTS.md](AGENTS.md) — the authoritative short guide for coding agents working in this repo
- [PRODUCT.md](PRODUCT.md) — product description: capabilities, the organization, reviews and proposals
- [Product brief](docs/product-brief.md)
- [Design system](docs/design-system.md)
- [Architecture decisions](docs/adr/README.md)
- [API contract](docs/api/gateway-v1.md)
- [Server scope](server-ts/SCOPE.md) and [routing](server-ts/ROUTING.md)
- [Changelog](CHANGELOG.md) — notable changes per release ([process](docs/changelog-process.md))

## Licensing

Berry is MIT licensed — see [LICENSE](LICENSE). Its web interface began as the
MIT-licensed Circle template, and every dependency it resolves is permissively licensed.
Both are recorded in [THIRD_PARTY_NOTICES.md](THIRD_PARTY_NOTICES.md).
