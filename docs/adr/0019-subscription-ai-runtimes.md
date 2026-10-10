# ADR-0019: User-scoped subscription AI runtimes

- **Status:** Accepted
- **Date:** 2026-10-08
- **Deciders:** Berry platform
- **Related:** [ADR-0014](0014-agentcore-runtime-control-plane.md), [ADR-0017](0017-kilo-gateway-model-tiers.md)

## Context

Berry currently uses the word runtime for the compute host that receives a task envelope: an AgentCore Runtime or the same image over HTTP. Products people call an AI runtime are a different layer. Some are model providers, some are coding-agent processes, and some are frameworks that need credentials for another provider. Their account, model, authentication method, billing owner, and execution semantics cannot be inferred from one another.

A consumer subscription also is not an API entitlement. Several official CLIs can use a subscription only while the CLI owns its login on the same machine. Copying that credential into Berry, reading a browser cookie, or presenting an undocumented OAuth client would cross the provider's supported boundary. Berry is self-hosted and can run remotely from the person's laptop, so a local login is not reachable unless the provider offers a documented delegated token or server protocol.

## Decision

1. **Keep compute hosts separate.** Existing `agent_runtimes`, runtime profiles, and `/api/v1/runtimes/{id}` continue to describe where task envelopes run. The AI runtime catalog describes which agent or inference implementation works inside that host.
2. **Keep four identities explicit.** Every catalog item names its runtime product, execution mode (`direct_inference` or `agent_process`), underlying model-provider behavior, and billing/authentication method. Framework installation never implies model access.
3. **Connections belong to one person, and connected ones take agent work.** A connection is keyed by `(workspace, user, runtime)`. Once any subscription runtime is connected in the workspace, agent runs use one: the task override, then the project's runtime, then the authorizing person's preference, then that person's newest connection, then the workspace's newest connection. The run snapshots that connection. Completion calls stay on Bedrock or Kilo. An explicit Berry-managed override on one task stays there too.
4. **Snapshot selection at admission.** Runtime key, model selection, and connection id are copied onto the run when it is queued. Later changes to preferences or task settings do not retarget queued work.
5. **No silent fallback.** A missing, expired, unsupported, or exhausted subscription fails with a normalized actionable error. Berry never falls back to Bedrock, Kilo, a paid API key, another runtime, another model, or another person's account.
6. **Official credential ownership only.** Runtime-managed login remains in the provider process and its supported credential store. Berry stores a credential only for an official integration flow intended for third-party/server use, sealed with `INTEGRATION_ENCRYPTION_KEY`. Disconnect clears Berry-managed credentials and cancels runs using that connection.
7. **The product server does not call a model.** Model and agent SDK imports remain under `server-ts/src/agents/runtime/`. The product server stores catalog facts and selections, creates envelopes, and records normalized lifecycle events. Kiro is started on the workstation by that server; the runtime image's adapter registry stays empty.
8. **Preserve agent semantics.** A direct-inference adapter and an agent-process adapter implement different interfaces. Agent-process adapters stream tool and execution events and retain their own session/cancellation semantics instead of being flattened into text generation.
9. **Executable adapter: Kiro.** Kiro's official headless credential is a paid-plan API key. Berry seals that key, gives each run an empty CLI home, and passes the key only into that process. Kiro's own shell and file tools are denied. Berry tools are the only MCP server it may call. `kiro-cli` runs on the user workstation, started by the Berry server as its own process, with `acp --agent-engine=v3`. It is not bundled and it is not started inside the runtime container. GitHub Copilot is not a Berry runtime. GitHub sign-in and the GitHub App stay for identity and repository access.
10. **Catalog unavailable honestly.** Every requested product appears in the catalog. An item without a supported Berry execution/authentication boundary is unavailable with a concrete reason and official evidence. A known protocol with no safe credential path is not a working integration.

## Current state (2026-10-08)

- Kiro and Claude Code are connectable. Claude runs `claude` on the workstation and leaves the CLI login in the CLI; an API-key login is refused. GitHub Copilot is not in the catalog. GitHub sign-in and the GitHub App stay for identity and repository access.
- The product server starts `kiro-cli acp --agent-engine=v3` on the workstation. Those are the only arguments: v3 rejects `--agent`. The CLI is not in the runtime image, and that image's adapter registry is empty. Kiro does not give Berry a container per model. `kiro-cli chat --cloud` is a Kiro-hosted sandbox for a whole session; Berry does not set `_meta.kiro.executionTarget`.
- With a subscription connected, Settings → Model tiers places that runtime's models on BerryMax, BerryMid and BerryLow (`workspace_tier_models`, keys `runtime/model`). The same model may sit on more than one tier. A tier holds at most three, and a model only once inside one tier. A run with no explicit model uses the first model on the Berry agent's tier that this runtime offers. A completion runs as the Orchestrator and uses the first connected model on that agent's selected tier. With no model placed there, the completion stays on Bedrock or Kilo.
- Subscription usage is recorded from Kiro's context breakdown and stored unpriced. Credits and a usage percentage are not token counts.

## Selection precedence

For an agent run:

1. task or conversation override, including an explicit Berry-managed (`berry-native`) opt-out;
2. the task's project runtime, when the task itself has none;
3. the authorizing person's workspace preference;
4. that person's newest connected subscription runtime;
5. the workspace's newest connected subscription runtime;
6. Berry's native Strands runtime on the deployment's Bedrock or Kilo configuration, only when nothing is connected.

An explicit non-native selection must have a connected runtime in the workspace. Step 6 is the absence of a subscription, not a fallback after one fails.

## Adapter contract

All adapters report identity, capabilities, installation availability, authentication state, models, usage when exposed, and normalized errors. Direct inference adapters start or resume model conversations and stream model/tool-request events. Agent-process adapters start or resume the provider's agent session, stream text/tool/execution/status events, accept cancellation and deadlines, and expose only tools admitted by Berry's organization and permission rules.

## Consequences

- Existing compute-host registrations and already-issued task envelopes remain valid; AI-runtime fields are additive and optional.
- Personal subscription work is snapshotted to one connection. Agent runs, including delegated and unattended ones, use a connected subscription so they are not billed to Kilo. Completion calls stay on the deployment model.
- Runtime products whose login is local-only require a future companion or a provider-supported remote boundary. Berry will not tunnel credential stores as a substitute.
- Provider catalog facts can age. The matrix records an evidence date and links official sources so availability can be reviewed without changing the wire contract.
