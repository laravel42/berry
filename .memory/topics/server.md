# Server

- 2026-09-14 — **Supersedes entries below.** `server-ts` is the only server;
  `src/migrate` applies forward-only checksummed migrations, `src/seed`
  writes the idempotent dev dataset. `src/runs/dispatcher.ts` claims runs
  with `SKIP LOCKED` under a renewed lease. `/metrics` and `/catalogs` are
  served, not 404. Model SDKs (Bedrock, Strands) are confined to
  `src/agents/runtime/`, enforced by `pnpm check:models`.
- 2026-09-01 — GitHub is an App Berry creates for itself via the manifest
  flow; repository work runs on per-run installation tokens.
  `GITHUB_CLIENT_ID`/`SECRET` remain only as a legacy fallback.
- 2026-09-01 — Writing a migration file schedules it for the next server
  restart; ship the migration and the code that needs it together.
