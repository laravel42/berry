# Architecture

- 2026-09-14 — **Supersedes all entries below.** One repo, three pnpm
  workspaces: `server-ts` (Node 22, no build step), `frontend` (Next.js), and
  `packages/plugin-sdk`. ADR-0014 is current: Berry is the control plane and
  imports no model SDK; agent loops run in an AgentCore Runtime container or
  the same image over HTTP. Docker Compose is removed entirely — host
  PostgreSQL, no containers. The Valkey relay exists in code but is not wired
  anywhere; realtime is poll-based from `outbox_events`. ADR-0008 (in-process
  Google ADK) is superseded by ADR-0013 (SDK) and ADR-0014 (loop location);
  ADR-0013's SDK and plugin choice still stands. ADR-0010 is now Implemented;
  ADR-0011 is partially superseded for GitHub.
- 2026-08-22 — Licensing: MIT/Apache-2.0 only; retain Circle notices; no
  third-party product branding (`docs/product-brief.md`).
- 2026-09-01 — ADR-0010 (goals as derived groups) and ADR-0011 (refresh
  provider credentials) are both **Proposed**, not accepted.
