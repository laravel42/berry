# Route map and reference notes

The authoritative source is `src/index.ts`, which mounts every prefix below
through `src/mounts/*.ts`. This file groups them for a reader and keeps a
handful of reference notes that stay useful independent of any one route. For
the server's internal structure, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).
For what is intentionally *not* served, see [`SCOPE.md`](./SCOPE.md).

## Route map

Platform:

- `/health` — liveness
- `/ready`, `/readyz` — database probe
- `/metrics` — Prometheus text (served; not gated on `METRICS_ENABLED`, which is parsed but unused)
- `/api/v1/config` — version and capabilities

Auth and identity:

- `/api/auth` — Better Auth (GitHub sign-in, callback, session, sign-out), mounted only when auth is configured
- `/api/v1/auth` — `GET /me`; `POST /dev-login` only when dev-login is enabled
- `/api/v1/me` — account, settings, profile
- `/api/v1/tokens` — personal access tokens
- `/api/v1/invitations`, `/api/v1/join-links`
- `/api/v1/workspaces` — workspaces, plus nested work catalogs (issue-statuses, issue-properties, quick-actions, join-links)

Work tracking:

- `/api/v1/boards` — boards, including board runs
- `/api/v1/issues` — issues plus comments, relations, attachments, artifacts, runs, and tracking routes (quick, batch, batch-delete, assignee-frequency, activity, children, labels, metadata, properties, reactions, subscribers, status, move, quick-actions)
- `/api/v1/comments` — comments, including comment tracking
- `/api/v1/goals`, `/api/v1/projects`, `/api/v1/plans`
- `/api/v1/reviews` — review queue and run diffs
- `/api/v1/approvals`, `/api/v1/inbox`, `/api/v1/pins`
- `/api/v1/catalogs`, `/api/v1/search`, `/api/v1/views`
- `/api/v1/attachments`, `/api/v1/artifacts`

Agents and runs:

- `/api/v1/agents` — roster, capabilities, guide, models, per-agent config/permissions/contract/labels/env/avatar
- `/api/v1/agent-builder`
- `/api/v1/runs`
- `/api/v1/runtimes` — runtime registrations, profiles, agent binding, health
- `/api/v1/agent-tools` — task-token auth only; the runtime calling Berry's tools
- `/api/v1/organization`, `/api/v1/work-proposals`
- `/api/v1/skills`, `/api/v1/mcp-servers`
- `/api/v1/autopilots`
- `/api/webhooks/autopilots/:token` — public, signed autopilot webhook deliveries
- `/api/v1/conversations` — chat
- `/api/v1/editor` — editor AI

Integrations, plugins and usage:

- `/api/v1/integrations` — includes the GitHub App manifest flow
- `/api/v1/github`, `/api/v1/webhooks`
- `/api/v1/plugins`
- `/api/v1/usage`, `/api/v1/dashboard`

Realtime:

- `/api/v1/events` — one SSE stream per board and one per workspace, replayed from `outbox_events`

Public API:

- `/v1` — personal and plugin tokens only: `GET /context`, `GET|PATCH /issues/:ref`, `GET|POST /issues/:ref/comments`, `GET /storage`, `GET|PUT|DELETE /storage/:key`

If a prefix here stops answering, that is a bug, not a scope decision — see
[`SCOPE.md`](./SCOPE.md) for what is deliberately absent.

## Linking a GitHub repository

Berry stores a repository's id beside its name, and resolves that id through
GitHub rather than trusting the caller — a supplied id could name a
repository the connection cannot see, and the stored pair would then disagree
about where the project delivers. A database constraint keeps the two columns
together.

The resolver is implemented (`resolveRepository` in `mounts/projects.ts`). On
create and PATCH, a `githubRepo` (`owner/name`) is resolved through the same
credential the picker lists with — `githubToken()` + `GitHubClient`, App token
first, else the OAuth connection — and the id and name are written together.
The status codes are meaningful and distinct:

- **412 INTEGRATIONS_NOT_CONFIGURED** — no encryption key, so no credential can
  be held; nothing can resolve a repository here.
- **409 NOT_CONNECTED / CONNECTION_UNUSABLE** — a provider exists but has no
  usable credential (no App installed, or an absent/expired OAuth connection).
- **422 REPOSITORY_UNAVAILABLE** — the credential is fine but the repository
  cannot be resolved (missing, or unseen by this credential).
- **502 PROVIDER_ERROR** — a transient GitHub failure, worth retrying.

None of these writes a half-link, so a project never ends up in a broken
state. Clearing the link (`githubRepo: null`) needs no resolver and always
succeeds.

## Sign-in

GitHub is the only way in, through Better Auth at `/api/auth/*`, using a
GitHub **OAuth App** of its own (`BERRY_AUTH_GITHUB_CLIENT_ID`/`_SECRET`,
scope `repo` plus profile, callback `<BERRY_APP_URL>/api/auth/callback/github`),
separate from the repository GitHub App. `repo` grants read and write on the
person's repositories and their issues, private ones included; OAuth Apps
have no narrower read-only or issues-only scope. A GitHub account links to an
existing Berry user only through a GitHub-verified email. Sessions are a
Better Auth cookie; personal access tokens remain the bearer credential for
API clients. `POST /api/v1/auth/dev-login` (`{email}`) signs in an existing
user by email when `APP_ENV` is explicitly `development` or `test` and
passwordless login is allowed — development and test only.

## The JSON escaping every response gets

Go's `encoding/json` (the previous server's runtime) escapes `<`, `>` and `&`,
and escapes U+2028/U+2029, which `JSON.stringify` otherwise leaves literal.
`goJSON` in `src/http/canonical-json.ts` applies the same escaping to the
finished text — safe, because none of those characters is JSON syntax, so
wherever one appears in the output it is already inside a string literal.
`json()` in `src/http/app.ts` uses it, so every mount gets it. This matters
because clients and cursors decode this exact byte shape; changing it would
be a wire break.

## Database-backed tests

The ledger and artifact tests need a real PostgreSQL, because everything they
are for happens in the database: the sequence is allocated by a SQL function,
the ordering guarantee is arithmetic PostgreSQL performs, and the jsonb
column is where a wrongly-encoded envelope stops looking wrong.

They run against their own database rather than the development one. Not
fastidiousness: creating a workspace fires a trigger that provisions a
**protected** Orchestrator agent, and a protected agent refuses both deletion
and unprotection — so a fixture in the development database leaks a
workspace on every run and cannot tidy up after itself. Never point
`BERRY_TEST_DATABASE_URL` at the dev database.

`C` collation on purpose: ordering assertions (agents by name, for one)
expect byte order, and a host database on `en_US` sorts case-insensitively.

```sh
psql -h 127.0.0.1 -U <user> -d postgres \
  -c "CREATE DATABASE berry_test TEMPLATE template0 LC_COLLATE 'C' LC_CTYPE 'C'"
pg_dump -h 127.0.0.1 -U <user> --schema-only --no-owner --no-privileges berry \
  | psql -h 127.0.0.1 -U <user> -d berry_test -q

BERRY_TEST_DATABASE_URL='postgres://<user>@127.0.0.1:5432/berry_test?sslmode=disable' \
  pnpm test:server
```

Without the variable the suite skips these tests and still passes, so `pnpm
test:server` works on a machine with no database running.

## History

This server replaced an earlier Go implementation (ADR-0009); some historical
notes and comments elsewhere in the repo still describe that transition, the
removed Docker Compose stack, or an OpenRouter-backed model catalogue — none
of that reflects the current code. The model client is Bedrock, reached only
from `src/agents/runtime/`, and there is no Compose stack to run.
