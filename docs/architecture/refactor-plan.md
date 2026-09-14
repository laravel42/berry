# Architecture Refactor Plan (historical)

This document recorded a discovery pass and a small, phased server/frontend
cleanup on branch `refactor/architecture-clarity`. That work is done — Phases
1 through 5 were completed and verified; Phase 6 was optional polish and was
not required. Its findings are historical: the four local corrections it made
(moving the `GoalLinker` interface into `core/`, relocating the shared
Bedrock client, deleting dead frontend filter helpers, and an audit of inline
queries in `mounts/`) already landed and are not pending work.

Follow-ups the plan logged but deliberately deferred:

- Extracting an `AccountRepository` out of `mounts/account.ts` once
  `/api/v1/me/*` has wire-level test coverage.
- Removing the `teamId`/`teamIds` vestiges left over from the removed Crew
  module.

Reconciling ADR-0008/ADR-0009 with the implemented dispatcher was also logged
as a follow-up; that reconciliation is superseded by ADR-0014, which is now
the accepted design for agent execution.

The plan's description of the repository as four packages (`server-ts`,
`frontend`, `runtime`, `runtime-worker`) is no longer accurate — see
[server-ts/ARCHITECTURE.md](../../server-ts/ARCHITECTURE.md) and
[ADR-0014](../adr/0014-agentcore-runtime-control-plane.md) for the current shape and the
current agent-execution design.
