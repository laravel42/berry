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
| `docs` | Product brief, ADRs, API contract, design system, and [AI runtime matrix](docs/ai-runtimes.md) |

The server, frontend, plugin SDK, desktop and mobile packages form a pnpm workspace
and do not share a validation workflow (different formatters and linters) — see [AGENTS.md](AGENTS.md) for the
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

Berry connects supported AI subscriptions so teams can coordinate agents using
accounts they already pay for. Subscription access and limits remain with the
provider. Native/API execution is a separate option; a disconnected subscription
does not silently fall back to API billing. See [AI runtimes](docs/ai-runtimes.md).

Berry can run directly on the host. Optional Docker development and Dokploy
deployment stacks are documented in [deploy/local](deploy/local/README.md) and
[deploy/dokploy](deploy/dokploy/README.md).

| Dependency | Purpose |
| --- | --- |
| PostgreSQL 16 | Berry's durable product state, reached through `DATABASE_URL` |
| AWS S3 (or an S3-compatible store) | Artifact storage, through the `S3_*` variables |
| AWS Bedrock AgentCore Runtime | Where agents run ([ADR-0014](docs/adr/0014-agentcore-runtime-control-plane.md)) |
| Kilo AI gateway (optional) | Native model calls in Berry's model tiers instead of straight to Bedrock ([ADR-0017](docs/adr/0017-kilo-gateway-model-tiers.md)) |
| User AI subscription | Supported official CLIs on the workstation that runs Berry ([matrix and setup](docs/ai-runtimes.md)); connected subscription runs do not require model API billing |

Provider keys and object-store credentials are server-side only, never under a
`NEXT_PUBLIC_*` name.

## Quick start

Prerequisites: Node 22 (with `--experimental-strip-types`), pnpm 12.5.1 (the version pinned in package.json), a
PostgreSQL 16 instance you run yourself, and Python 3 for repository checks.

```sh
cp .env.example .env
pnpm install
```

```sh
pnpm db:migrate   # forward-only, under an advisory lock; reads DATABASE_URL
pnpm db:seed      # idempotent development dataset
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
calls the model — Amazon Bedrock directly by default, or the Kilo AI gateway — and
streams lifecycle events (`task.started`, `task.message`, `task.usage`, `task.completed`,
`task.failed`) back to Berry, which is the only writer of run state. The agent acts on
Berry exclusively through `/api/v1/agent-tools/*` with a short-lived, task-scoped token —
never through the database directly.

For agent execution, connect a subscription AI runtime (Kiro, Claude Code,
Codex, or another workstation CLI) and place its models on Berry tiers in
Settings → Model tiers. AgentCore is the AWS compute host for the
runtime image, not a model provider:

- A deployed runtime image, if you use AgentCore. `server-ts/sandbox/agentcore/deploy.sh` builds it, pushes it
  to ECR and publishes it as an AgentCore Runtime; it needs account-owner AWS credentials
  and Docker buildx on the machine running it. Point `BERRY_AGENTCORE_RUNTIME_ARN` at the
  ARN it prints. (Alternatively, set `BERRY_AGENT_RUNTIME_URL` to call the same image over
  HTTP without AgentCore.)
- A public callback URL: the runtime calls Berry back on `BERRY_RUNTIME_CALLBACK_URL` (or
  `BERRY_PUBLIC_URL`), which AWS must be able to reach — a tunnel when developing locally.
- `S3_BUCKET` so a run's files have somewhere to land, and `INTEGRATION_ENCRYPTION_KEY`
  if the run needs GitHub or plugin credentials.

There is no native Bedrock or Kilo model path. Completions and agent runs
fail until a subscription is connected. Tiers remain: each agent is on
BerryMax, BerryXHigh, BerryHigh, BerryMid or BerryLow, and a run uses the
first connected model on that tier unless the task names one. Kiro runs as
`kiro-cli` on this workstation; it does not run in the runtime image.

Without a runtime target, `agentExecution` reports `false` in `GET /api/v1/config` and
the dispatcher, scheduler and review gate simply do not start — the rest of Berry works
normally.

## Documentation

- [Documentation website](documentation/README.md) — searchable product guides, setup, operations, and API reference; preview with `npm --prefix documentation run dev` after installing its dependencies.

- [AGENTS.md](AGENTS.md) — the authoritative short guide for coding agents working in this repo
- [PRODUCT.md](PRODUCT.md) — product description: capabilities, the organization, reviews and proposals
- [Product brief](docs/product-brief.md)
- [Design system](docs/design-system.md)
- [Architecture decisions](docs/adr/README.md)
- [API contract](docs/api/gateway-v1.md)
- [Server scope](server-ts/SCOPE.md) and [routing](server-ts/ROUTING.md)
- [Changelog](CHANGELOG.md) — notable changes per release ([process](docs/changelog-process.md))

## Licensing

Berry is licensed under the GNU Affero General Public License v3. See [LICENSE](LICENSE).
Berry's own code stays AGPL-3.0-only.
The web interface began as the MIT-licensed Circle template; that notice stays in `frontend/LICENSE.md`.
Shipped dependencies may be MIT, Apache-2.0, or Elastic License 2.0. Elastic License 2.0 code may not be offered as a managed service, may not have its notices or license-key checks stripped, and is not relicensed to AGPL.