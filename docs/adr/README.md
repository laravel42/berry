# Architecture Decision Records

This directory records consequential technical decisions for Berry. An ADR
captures the context and trade-offs known when a decision is made; it is not a
substitute for an API or integration contract.

## Status vocabulary

- **Proposed** — under discussion and not yet binding.
- **Accepted** — the current direction; implementations and contracts should
  conform.
- **Implemented** — accepted and built as decided; use when "Accepted" alone
  would leave the build status ambiguous (for example, a record that once
  read "Proposed" but the code now matches it).
- **Partially implemented** — some phases or pillars of a phased decision are
  built and live, others are not; the status line says which.
- **Deprecated** — retained for history but no longer recommended.
- **Superseded** — replaced by another ADR, which must be linked from both
  records. **Superseded by ADR-00NN** names the record that replaced it;
  **Partially superseded** — part of the decision still holds, part has been
  replaced (the status line says which part, and by what).

Accepted ADRs are immutable apart from typo and link fixes. When a decision
changes materially, add a new ADR and mark the old one **Superseded**.

## Reading these ADRs today (2026-09-14)

Each record's Context, Decision and Consequences are historical: they
describe the reasoning and the system at the time the decision was made, and
that text is not rewritten as the system changes. To find out whether a
decision is still what runs, read its **Status** line and its **Current
state** section (added below the metadata block) rather than the body.
[ADR-0014](0014-agentcore-runtime-control-plane.md) describes the current
execution design — Berry as a control plane, the agent loop running inside
AgentCore Runtime — and supersedes the "loop stays in Berry's process" parts
of ADR-0008, ADR-0012 and ADR-0013. For the fuller current mechanism, see
`server-ts/ARCHITECTURE.md`.

## Decision log

| ADR | Decision | Status | Date |
|---|---|---|---|
| [0002](0002-valkey-for-ephemeral-state.md) | Use Valkey for cache and ephemeral coordination state | Accepted (Valkey itself optional, unwired) | 2026-08-22 |
| [0006](0006-agent-run-artifacts.md) | Store agent run artifacts in object storage, indexed as attachments | Accepted (backend is AWS S3, not MinIO) | 2026-08-24 |
| [0008](0008-adk-agent-runtime.md) | Run agents in-process with the Google Agent Development Kit | Superseded by [0013](0013-strands-native-agent-runtime.md), then [0014](0014-agentcore-runtime-control-plane.md) | 2026-08-27 |
| [0009](0009-typescript-product-server.md) | Reimplement the product server in TypeScript | Accepted | 2026-08-27 |
| [0010](0010-goals-as-derived-task-groups.md) | Goals are derived groups of a project's tasks | Implemented | 2026-09-01 |
| [0011](0011-refresh-provider-credentials.md) | Refresh provider credentials before they expire | Partially superseded, for GitHub, by its own GitHub App; Proposed for other providers | 2026-09-01 |
| [0012](0012-agentcore-managed-services.md) | Operate agents on AgentCore Runtime, Gateway, Memory, and Policy | Partially implemented (Runtime, Memory delivered; Gateway dormant; Policy not started) | 2026-09-09 |
| [0013](0013-strands-native-agent-runtime.md) | Run agents natively on the Strands Agents SDK | Partially superseded by [0014](0014-agentcore-runtime-control-plane.md) (loop location only) | 2026-09-09 |
| [0014](0014-agentcore-runtime-control-plane.md) | Berry is a control plane; the agent loop runs in AgentCore Runtime | Accepted — current execution design | 2026-09-10 |
| [0015](0015-default-agent-organization.md) | Provision every workspace with a default agent organization | Accepted; partially superseded by [0016](0016-autogate-delegated-release.md) (what a passing review does) | 2026-09-14 |
| [0016](0016-autogate-delegated-release.md) | AutoGate delegates the release decision, once per plan | Accepted — current release policy | 2026-09-17 |

### Withdrawn records

0001, 0003, 0004, 0005 and 0007 were removed on 2026-08-28 together with the
subjects they decided — the Bun/Hono gateway, the external agent runtime, the
Go product server, Temporal orchestration, and the Activepieces adapter. The
numbers are not reused. What replaced them is recorded in
[0008](0008-adk-agent-runtime.md) and [0009](0009-typescript-product-server.md);
this is the only case in which a record is deleted rather than superseded, and
it happens because the code it described no longer exists to conform to it.

## Adding a record

1. Copy [the template](0000-template.md) to the next zero-padded number.
2. Use a short, action-oriented filename and fill every section. Write “None”
   where a section has no content rather than deleting it.
3. Add the record to the decision log above.
4. Link related requirements, contracts, and ADRs with repository-relative
   links.
