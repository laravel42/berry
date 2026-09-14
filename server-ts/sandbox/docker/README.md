# `sandbox/docker` (not wired)

This directory holds a Docker-based execution driver: `runtime/` (a small HTTP
service that runs one disposable container per Berry run against the Docker
Engine API), `Dockerfile` (the image a run's commands would execute in), and
`Dockerfile.runtime` (the image the service itself would ship as).

**The server does not select this driver.** `BERRY_RUNTIME_DRIVER` is parsed
in `src/config/config.ts` but never read by `src/index.ts` to choose an
executor — target selection there only looks at `BERRY_AGENTCORE_RUNTIME_ARN`
and `BERRY_AGENT_RUNTIME_URL` (see
[`../../ARCHITECTURE.md`](../../ARCHITECTURE.md#agent-execution-the-control-plane)).
`src/execution/factory.ts`, which would build a driver from that config
value, is not imported anywhere in the server. Agent runs go through the
AgentCore Runtime or its HTTP fallback, per ADR-0014.

The code still builds and its tests still run as part of `pnpm test:server`
(no daemon needed for that). It is legacy from an earlier execution design
and is not part of normal development — do not run it, and do not point
`BERRY_RUNTIME_URL`/`BERRY_RUNTIME_TOKEN` at it, unless you are specifically
working on reviving this driver.
