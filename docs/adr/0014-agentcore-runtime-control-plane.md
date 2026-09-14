# ADR-0014: Berry is a control plane; the agent loop runs in AgentCore Runtime

- **Status:** Accepted — this is the current execution design; implemented
  and live.
- **Date:** 2026-09-10
- **Deciders:** Berry platform
- **Related:** ADR-0008, ADR-0012, ADR-0013
- **Supersedes:** the "loop stays in Berry's process" parts of ADR-0008, ADR-0012 and ADR-0013.
  Their other decisions stand: Berry owns the ledger, the tools' product surface
  and the workspace; Strands is the loop; Bedrock is the model.

## Current state (2026-09-14)

- Live as described: `src/runs/dispatcher.ts` claims work under a renewed
  lease and dispatches via `InvokeAgentRuntime`
  (`src/runtime/agentcore-transport.ts`), or over HTTP to the same image when
  only `BERRY_AGENT_RUNTIME_URL` is set (`src/runtime/http-transport.ts`).
  Target selection is in `src/index.ts` (~line 437).
- The runtime image is built from `server-ts/sandbox/agentcore/Dockerfile`
  from the sources in `src/agents/runtime/`; `sandbox/agentcore/deploy.sh`
  pushes and publishes it and needs account-owner AWS credentials.
- Since this ADR, Berry additionally provisions a default "organization" of
  role agents on top of this execution design (autonomy ceilings, delegation,
  required reviews) — see `server-ts/src/organization/` and
  [ADR-0015](0015-default-agent-organization.md). That layer constrains which tools a run may reach; it does not
  change how or where the loop executes.
- `runtimes` registrations (`agent_runtimes` table, migration
  `053_agentcore_runtime_control_plane`, `src/runtime/runtimes.ts`) let an
  operator register, bind and observe additional runtimes beyond the
  platform default, per point 3 of the Decision.
- Decision point 7 is not live: the server never selects the local `docker`
  driver. `BERRY_RUNTIME_DRIVER` is parsed in `src/config/config.ts` but never
  used to choose a target, `src/execution/factory.ts` is imported nowhere, and
  `src/index.ts` builds the default target only from
  `BERRY_AGENTCORE_RUNTIME_ARN` or `BERRY_AGENT_RUNTIME_URL`. The HTTP
  fallback is `BERRY_AGENT_RUNTIME_URL`; see `server-ts/sandbox/docker/README.md`.
- For the current wiring end to end, `server-ts/ARCHITECTURE.md` is the
  fuller reference; this ADR states the decision, not the full mechanism.

## Context

The loop ran in the API process and reached a runtime container one shell
command at a time through `InvokeAgentRuntimeCommand`. Every command was a
network round trip, and the API held Bedrock credentials and a model client.
The parity spec requires Bedrock to be reached only from inside AgentCore
Runtime, sessions to be resumable per `(agent, issue)`, and one runtime
concept that operators can register, bound and observe.

## Decision

1. The Strands loop, its plugins and its local tools run in the runtime image
   (`server-ts/sandbox/agentcore/`), from the same sources in
   `server-ts/src/agents/runtime/`, under `--experimental-strip-types`.
2. The server dispatches with `InvokeAgentRuntime`: a JSON `TaskEnvelope` in, an
   SSE stream of `LifecycleEvent`s out (`task.started`, `task.message`,
   `task.usage`, `task.completed`, `task.failed`). The ledger stays the only
   writer of run state. A stream ending without a terminal event is
   `RUNTIME_STREAM_ENDED`, retryable. Cancel aborts the stream and calls
   `StopRuntimeSession`.
3. `runtimeSessionId = "berry-" + sha256(agentId + ":" + issueId)` (chat:
   `(agentId, chatSessionId)`); completion tasks get a fresh session. The
   container keeps warm conversations per session; the envelope always carries
   a transcript rebuilt from `run_events` so a reaped microVM restores cold.
   Lifecycle: idle timeout 3600 s by default (per runtime profile, at most
   28800), `maxLifetime` 28800 s, `/ping` answers `HealthyBusy` while working.
4. Agents act on Berry through `/api/v1/agent-tools/*` with a task-scoped token
   (`task_tokens`), never through the database.
5. Single model calls (planner, triage, review gate, chat, editor) are
   `kind: 'completion'` tasks via `runCompletion`.
6. `scripts/check-no-model-in-server.py` fails when `server-ts/src` outside
   `agents/runtime/` imports a model SDK, or any `package.json` depends on a
   provider SDK. `agents/catalog.ts` may use the Bedrock *control plane* to list
   models.
7. The local `docker` driver runs the same image with the same `/invocations`
   contract.

## Consequences

- The API image no longer needs Bedrock credentials; the runtime's execution
  role (or, locally, the `agent-runtime` service's env) does.
- Every image change needs a redeploy of the runtime.
- `BERRY_PUBLIC_URL` must be reachable from AgentCore (a tunnel locally).
- `StopRuntimeSession` on cancel ends a session that later runs may reuse; the
  cold path restores it.
- A run past `maxLifetime` loses its lease, is re-queued retryable and resumes
  cold.
- The session lifecycle is a runtime setting, not a session one. The default
  (idle 3600 s, life 28800 s) is applied once per deploy, because each
  `UpdateAgentRuntime` creates a runtime version:
  `aws bedrock-agentcore-control update-agent-runtime --agent-runtime-id <id>
  --lifecycle-configuration idleRuntimeSessionTimeout=3600,maxLifetime=28800
  --agent-runtime-artifact file://artifact.json --role-arn <role>
  --network-configuration networkMode=PUBLIC`. A profile's idle timeout on a
  registered runtime is written by Berry when the profile is saved.
