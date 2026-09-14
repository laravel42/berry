# Berry — Frontend

Next.js frontend for Berry, a self-hosted multi-workspace work tracker where
humans and AI agents share one board. Vendored from the MIT-licensed
[Circle](https://github.com/ln-dev7/circle) template (see `LICENSE.md` for the
upstream notice) with its demo/mock data layer stripped.

The browser calls Berry only, through `lib/api.ts`. It never receives a
provider credential or talks to a model provider directly.

## Stack

Next.js 15 (App Router) · React 19 · TypeScript · Tailwind CSS v4 ·
shadcn/ui · Zustand · next-intl · nuqs · next-themes. Managed with **pnpm**
(this workspace is part of the root pnpm workspace, not a standalone
package). Format with Prettier **3-space**; lint with ESLint.

## Getting started

From the repo root:

```shell
cp .env.example .env && pnpm install
cp frontend/.env.example frontend/.env.local   # optional
pnpm dev:frontend
```

Or from `frontend/` directly: `pnpm dev` (runs `next dev --turbopack`).

## Configuration

The frontend reaches Berry through a same-origin proxy. `next.config.ts`
rewrites `/api/*`, `/v1/*`, `/health` and `/ready` to a server-only origin;
the browser never sees the upstream URL.

| Variable | Purpose |
| --- | --- |
| `BERRY_API_ORIGIN` | Server-only target for the proxy (default `http://127.0.0.1:4000`). Read only by the Next.js server; never put credentials in it. |
| `NEXT_PUBLIC_BERRY_API_URL` | Optional cross-origin escape hatch, inlined into the browser bundle. Leave empty outside deliberate cross-origin development. |
| `NEXT_PUBLIC_AUTO_LOGIN_EMAIL` | Dev-only auto-login email. |
| `NEXT_PUBLIC_BOARD_ID`, `NEXT_PUBLIC_WORKSPACE_SLUG`, `NEXT_PUBLIC_WORKSPACE_NAME` | Workspace/board defaults. |
| `NEXT_PUBLIC_CHANGELOG_URL`, `NEXT_PUBLIC_DOCS_URL`, `NEXT_PUBLIC_FEEDBACK_URL` | Optional external links surfaced in the UI. |

No secret may use a `NEXT_PUBLIC_*` name — that prefix ships to the browser.
The Berry client lives in `lib/api.ts` (`apiUrl` / `apiFetch`); it includes
same-origin credentials and parses Berry's error envelopes and request IDs.

## Verifying a change

```shell
cd frontend && pnpm lint && pnpm build:check
```

`build:check` writes to a throwaway `.next-verify` directory. Never run plain
`pnpm build` while a `next dev` server is running against the same `.next`
directory — it will corrupt the running dev server. There is no test runner;
also do a manual check of the changed view.

## App map

Authenticated routes live under the dynamic `app/[orgId]/` segment (one
workspace/organization per session). Public routes (`login`, `sign-in`,
`onboarding`, `invite`, `invitations`, `join`, `workspaces`) sit outside it.

High-level sections under `[orgId]/`:

- **Work tracking:** `tasks` (UI label for issues), `my-issues`, `issue/[issueId]`,
  `inbox`, `reviews`, `review`, `approvals`, `goals`/`goal`, `projects`/`project`,
  `plan`, `proposals` (agent-submitted work proposals).
- **Agents:** `agents`, `agent`, `skills`, `autopilots`/`autopilot`, `runs`, `chat`.
- **Other:** `dashboard`, `usage`, `views`/`view`, `members`, `plugins`, `profiles`,
  `attachments`.
- **Settings** (`settings/`): personal (preferences, notifications, shortcuts,
  security, tokens, connected-accounts), workspace (general, members, agents,
  **runtimes**, **organization**, labels, properties, quick actions), and
  connections (repositories, integrations, MCP, plugins). Runtimes and
  Organization are workspace settings pages, not top-level nav items.

There are no Squads — that surface was removed. A top-level `runtimes/` route
still exists only as a redirect into `settings/runtimes`, kept for old links.

## Data layer

Circle kept all domain types next to its demo data in `mock-data/`. The
directory is renamed `data/` and every demo dataset was removed. Types and
helpers stay so API wiring can land incrementally:

- `data/*.ts` — domain types and pure helpers (filtering, grouping, status
  ordering).
- `store/*.ts` — Zustand stores, typed by `data/`, filled from the API.
- `data/users.ts` exports a `currentUser` placeholder used by flows that
  need an identity before auth exists.

## License

Berry's own code and the Circle template code in this directory are
MIT-licensed. The upstream Circle notice is retained in `LICENSE.md`.
