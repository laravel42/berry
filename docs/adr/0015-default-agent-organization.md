# ADR-0015: Provision every workspace with a default agent organization

- **Status:** Accepted
- **Date:** 2026-09-14
- **Deciders:** Berry platform
- **Related:** [ADR-0014](0014-agentcore-runtime-control-plane.md) (agent
  loop runs in AgentCore Runtime; this ADR constrains what that loop may do),
  `docs/superpowers/specs/2026-09-14-berry-organization-design.md`

## Context

A newly created workspace had agents but no structure: no owner per
responsibility, no enforced limit on what an agent could do unattended, and
no required review before work reached a human. Autonomy and review were
prompt discipline, not something Berry enforced.

## Decision drivers

- A new workspace should behave like a small organization from day one.
- Autonomy must be enforced by Berry (which tools a run can reach), not a prompt.
- Every agent-authored change needs an independent domain reviewer before the
  human release gate; no agent may ever merge or move work to `done`.

## Considered options

1. Leave the roster free-form — autonomy and review stay conventions.
2. One generalist agent per workspace — no independent reviewer.
3. A provisioned organization of specialist roles with enforced contracts (chosen).

## Decision

Every workspace is provisioned with the Orchestrator plus 18 role agents
across product, engineering, quality/security, platform, growth-insight and
leadership (`server-ts/src/organization/catalog.ts`, `CATALOG_VERSION = 2`).
Each role's contract carries mission, delegates, an escalation target (a
role or `human`), review domains, and an **autonomy level**.

**Autonomy levels are ceilings enforced at the tool API**
(`src/organization/autonomy.ts`): effective tools = contract
`allowed_tools` ∩ level ceiling. Level 1 read/comment/escalate; Level 2 adds
write, task/project creation, `set_status`, `propose_work`,
`delegate_to_agent`, `mention_agent`; Level 3 adds `run_command`, `collect_file`; Level 4 has
the same ceiling as 3; Level 5 adds `submit_review`. **No ceiling includes a
merge tool**, and `set_status` only allows `todo | in_progress | in_review |
blocked` (`src/runtime/agent-tools/core-tools.ts`) — `done`/`cancelled` are
not agent-reachable. An invalid stored contract falls back to Level 1.

**Required reviews are rule-selected** (`src/organization/reviews.ts`) from
the author's contract, labels, changed paths and impact class — `blocking`
or `advisory`. QA is always blocking; Security is blocking on the `security`
label or security paths; the Software Architect is blocking on the
`architecture` label or paths. A Level 5 role's `submit_review` records a
blocking review, but "your approval never releases work: a person approves
the release" (`src/organization/prompt.ts`).

**Delegation is graph-checked** (`delegate_to_agent`/`mention_agent` refused
outside `src/organization/delegation.ts`), and discovered work is raised via
`propose_work`, deduplicated by fingerprint, auto-accepted into `todo` only for a Level 4+ proposer with non-critical/high severity and routine impact;
otherwise parked in `backlog` behind a `work_proposal` approval. **Provisioning is idempotent**
(`src/organization/provision.ts`, keyed on `role_key`, at boot): a contract
whose hash no longer matches the catalog is left alone; an archived role is
not re-inserted; the protected Orchestrator is adopted as role
`orchestrator`.

## Consequences

### Positive

- Every responsibility has a contracted owner from workspace creation, and no code path lets an agent release its own work.

### Negative

- 19 rows to provision and reconcile per workspace; an invalid contract degrades silently to Level 1 instead of failing loudly.

### Risks and mitigations

- **Risk:** a new tool bypasses every ceiling. **Mitigation:** `KNOWN_TOOLS` and the ceiling table are the single definition.
- **Risk:** a reviewer is missed by a labelling gap. **Mitigation:** QA is unconditionally blocking regardless of labels.

## Validation

`server-ts/src/organization/` unit tests cover autonomy ceilings, reviews,
delegation and provisioning idempotency; migration 186 tests assert
`role_key` uniqueness and edit survival across upgrades.

## Follow-up

None.
