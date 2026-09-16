---
inclusion: always
---

# Berry

Self-hosted, multi-workspace work tracker where humans and AI agents share one
board: task → assign (person or agent) → agent run → human review gate →
done. Berry is the control plane and imports no model SDK (ADR-0014). Agent
loops run in an AgentCore Runtime container, or in the same image reached
over HTTP, and call Berry back only through `/api/v1/agent-tools/*` with a
task-scoped token — never through the database. No longer in-process on the
Google ADK (ADR-0008, superseded).

Read `AGENTS.md` first. Then the matching doc under `docs/` (product brief,
coding playbook, gateway-v1, ADRs, design system), plus `server-ts/SCOPE.md`
and `server-ts/ROUTING.md` before touching the server.

## Three workspaces

`server-ts` (Node 22, no build step, `--experimental-strip-types`, Zod 4),
`frontend` (Next.js, Prettier **3-space** + ESLint, `@/`, Zod 4) and
`packages/plugin-sdk` (Node, strip-types) do not share a toolchain. Never
format one with another.

## Boundaries

- Browsers call Berry only. Never leak a provider credential; nothing secret
  may use a `NEXT_PUBLIC_*` name.
- Postgres is source of record for product data and the run ledger. The
  Valkey relay exists but is not wired anywhere; realtime works by polling
  `outbox_events`.
- Model SDKs (Bedrock, Strands) are allowed only under
  `server-ts/src/agents/runtime/`, enforced by `pnpm check:models`.
- Migrations in `server-ts/migrations` are forward-only, checksummed and
  immutable. Never edit an applied one; add a new one.
- The wire shape is a contract: cursors, idempotency fingerprints and the error
  envelope must keep decoding for clients that already hold them.
- Agents cannot set a task to done or cancelled, and there is no merge tool.
  A person always decides release.
- MIT / Apache-2.0 dependencies only. No Linear product branding or copied
  schema. No new `Linear*` identifiers.
- `strict` on, no `any` except vendored `frontend/components/data-table-filter/**`.
- English-only i18n. Repo-wide gates, not per-package lint:
  `pnpm check:models` and `python3 scripts/check-locale-catalogues.py`.

## No longer true

No Docker Compose stack — it was removed; bring your own host PostgreSQL.
There is no in-process run orchestration debate: `src/runs/dispatcher.ts`
claims and runs tasks under `SKIP LOCKED` leases. `/metrics` and `/catalogs`
are served, not 404.

## Process

Commits: `type(scope): summary (BERR-NN)`. One issue per PR.
