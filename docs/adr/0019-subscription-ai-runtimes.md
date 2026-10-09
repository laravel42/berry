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
3. **Connections belong to one person.** A connection is keyed by `(workspace, user, runtime)`. A run may use it only when `runs.requested_by` is that same user. Scheduled or delegated work never borrows another member's subscription.
4. **Snapshot selection at admission.** Runtime key, model selection, and connection id are copied onto the run when it is queued. Later changes to preferences or task settings do not retarget queued work.
5. **No silent fallback.** A missing, expired, unsupported, or exhausted subscription fails with a normalized actionable error. Berry never falls back to Bedrock, Kilo, a paid API key, another runtime, another model, or another person's account.
6. **Official credential ownership only.** Runtime-managed login remains in the provider process and its supported credential store. Berry stores a credential only for an official integration flow intended for third-party/server use, sealed with `INTEGRATION_ENCRYPTION_KEY`. Disconnect clears Berry-managed credentials and cancels runs using that connection.
7. **The runtime image owns adapters.** Model and agent SDK imports remain under `server-ts/src/agents/runtime/`. The product server stores catalog facts and selections, creates envelopes, and records normalized lifecycle events; it does not call a model or run an agent loop.
8. **Preserve agent semantics.** A direct-inference adapter and an agent-process adapter implement different interfaces. Agent-process adapters stream tool and execution events and retain their own session/cancellation semantics instead of being flattened into text generation.
9. **Executable adapters: GitHub Copilot and Kiro.** GitHub documents OAuth user tokens, one token per SDK session, `mode: "empty"` for multi-user servers, model discovery, sessions, streaming, tools, usage, and cancellation. Berry reuses the signed-in person's encrypted GitHub OAuth token, passes it only in that person's task envelope, disables ambient login and tools, and exposes only Berry-authorized tools. The MIT SDK and its pinned runtime artifact ship in the runtime image. Kiro's official headless credential is a paid-plan API key. Berry seals that key, gives each run an empty CLI home, and passes the key only into that process. Kiro's own shell and file tools are denied. Berry tools are the only MCP server it may call. `kiro-cli` runs on the user workstation, started by the Berry server as its own process. It is not bundled and it is not started inside the runtime container.
10. **Catalog unavailable honestly.** Every requested product appears in the catalog. An item without a supported Berry execution/authentication boundary is unavailable with a concrete reason and official evidence. A known protocol with no safe credential path is not a working integration.

## Selection precedence

For a person-started task or conversation turn:

1. task or conversation override;
2. that person's workspace preference;
3. Berry's existing native Strands runtime on the deployment's Bedrock or Kilo configuration.

An explicit non-native selection must have a connected, usable connection for the requesting person. The third step applies only when no non-native runtime was selected; it is not an error fallback.

## Adapter contract

All adapters report identity, capabilities, installation availability, authentication state, models, usage when exposed, and normalized errors. Direct inference adapters start or resume model conversations and stream model/tool-request events. Agent-process adapters start or resume the provider's agent session, stream text/tool/execution/status events, accept cancellation and deadlines, and expose only tools admitted by Berry's organization and permission rules.

## Consequences

- Existing compute-host registrations and already-issued task envelopes remain valid; AI-runtime fields are additive and optional.
- Personal subscription work is attributable and isolated per user, but automated work must use a deployment-owned runtime unless a provider later documents a non-personal service entitlement.
- Runtime products whose login is local-only require a future companion or a provider-supported remote boundary. Berry will not tunnel credential stores as a substitute.
- Provider catalog facts can age. The matrix records an evidence date and links official sources so availability can be reviewed without changing the wire contract.
