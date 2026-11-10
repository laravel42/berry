# ADR-0020: Loops are autopilots that answer events, under a safety policy

- **Status:** Accepted
- **Date:** 2026-11-08
- **Deciders:** Berry maintainers
- **Related:** [ADR-0014](0014-agentcore-runtime-control-plane.md) (runs are tasks the server hands to a runtime),
  [ADR-0016](0016-autogate-delegated-release.md) (release stays a person's),
  [ADR-0019](0019-subscription-ai-runtimes.md) (models are subscription runtimes),
  migrations `100_autopilots`, `036_retire_rules_engine`, `257_loops`

## Current state

A **Loop** is the product name for an autopilot. Storage (`autopilots`,
`autopilot_triggers`, `autopilot_runs`) and the wire (`/api/v1/autopilots`)
keep the autopilot name, the way issues are "tasks" on screen. The web app
serves `/loops`, `/loops/new`, `/loop/:id` and `/loop/:id/runs/:runId`;
`/autopilots` and `/autopilot/:id` redirect there.

A Loop fires on a schedule (cron), a signed webhook, an **event inside
Berry**, or a person pressing Run now. Each firing is a run record that
becomes one agent task through the shared queue; the dispatcher, the runtime
and the run ledger are the ones every other task uses. There is no second
scheduler, queue, runtime or agent framework.

## Context

Berry shipped autopilots (migration 100): an agent, a prompt, cron and webhook
triggers, quotas, versions and a run history. A "Loops" entry sat on the rail
with a coming-soon page. The product wanted Loops — recurring, goal-oriented
agent work that can also answer what happens in the workspace — with a
creation flow that starts from a sentence, inspectable runs, and safety
appropriate to agents acting without a person present.

Two facts from history bounded the design:

- Migration 036 removed a rules engine (trigger, step graph, conditions)
  because it did not earn its complexity. Judgement belongs in instructions
  the agent reads.
- No agent may release work: no merge tool, no `done` or `cancelled`
  (AGENTS.md, "Hard boundaries"). AutoGate (ADR-0016) is the only delegated
  release, and it is a person's consent per plan.

## Decision drivers

- One model of standing agent work; no duplicate tables, APIs or schedulers.
- Safe with any number of servers: no event fired twice, no slot fired twice.
- A Loop can never reach further than its agent; a new Loop starts able to
  report and propose, not change.
- Loops must not feed themselves or each other without limit.
- Existing autopilots keep behaving exactly as before.

## Considered options

1. **New `loops` tables and API beside autopilots.** Rejected: two models of
   the same thing, two schedulers, and a migration story for existing rows.
2. **Rename autopilots to loops in storage and on the wire.** Rejected:
   breaks issued URLs, client code and the public contract for no user gain.
3. **Extend autopilots additively; call them Loops in the product.** Chosen.

## Decision

### Event triggers

A trigger of kind `event` names a Loop event type and optional filters. The
event types are exactly the outbox topics Berry already writes, plus one
narrowing (`issue.status_changed` is `issue.updated` where the status moved):
task created / updated / status changed / assigned / started / completed,
comment added, project created / updated, agent run succeeded / failed,
approval requested, and a linked GitHub pull request changed. Approval
decisions are not written to the outbox and are not offered; GitHub states
only that a linked pull request changed, so "opened" and "merged" are a
filter on its state, not events.

Filters are at most eight rules, combined all/any, each a field in (or not
in) a list of values: project, status, previous status, priority, label,
assignee, who did it, changed field, pull request state. A filter on a field
the event type cannot state is refused when saved. There is no expression
language and no step graph.

**Delivery** (`autopilots/worker.ts`). One cursor row follows
`outbox_events`, locked `FOR UPDATE SKIP LOCKED`, two seconds behind now.
Every event an enabled trigger of an active Loop listens for becomes an
`autopilot_event_receipts` row *in the transaction that moves the cursor*, so
a crash neither loses nor repeats it. Receipts are claimed with `SKIP
LOCKED`, filtered, checked for lineage and fired; the unique index on
`autopilot_runs (trigger_id, trigger_event_id)` makes the firing exactly-once
across workers. A receipt left `processing` is reclaimed after five minutes
and given up after five attempts. Each receipt records its outcome (fired,
filtered, skipped and why), which the Loop's Events tab shows.

### Loop prevention

- Each run record carries `parent_autopilot_run_id` and `depth`. An event's
  parent is the Loop run that caused it: the run it names, a Loop run of the
  agent that acted, or the Loop run that opened the task it is about.
- A Loop never answers its own work at any distance (`LOOP_CYCLE`).
- `max_chain_depth` (default 0, hard limit 3) bounds how many Loop hops may
  lead to a firing (`CHAIN_TOO_DEEP`).
- Events an agent caused are ignored unless `allow_agent_events`
  (`AGENT_EVENT`).
- More than 20 event firings of one Loop in a minute are skipped
  (`RATE_LIMITED`), and `skip_if_running` (the default) skips a firing while
  a run of the Loop is queued or running (`ALREADY_RUNNING`). Run now and
  Retry are a person asking and pass both.

### Safety policy

`access_mode` is a ceiling applied on the server in two places: the
agent-tools allowlist (`organization/enforcement.ts`), which refuses a tool
call, and the envelope (`runtime/envelope-builder.ts`), so the agent is not
told about tools it would be refused.

- **recommend** (default for new Loops): read tools, `post_comment`,
  `escalate`, `propose_work`, and files on the run's own task. No task
  mutation, delegation, shell or repository write; repository permissions
  drop to `read_repository`, so no branch or pull request is delivered.
- **act**: the agent's own contract, unchanged.

Both modes only subtract. An agent outside the organization (no contract,
"its permissions govern it") is closed, not left open, in recommend mode.
`max_turns` joins the envelope's existing minimum; `max_duration_minutes` is
enforced by cancelling through the ledger's `markCancelled` — the same call
as a person's Cancel — and marking the record timed out.

Event facts reach the agent as a fenced JSON block after the Loop's
instructions, labelled as data; task titles are one line and 200 characters;
descriptions and comment bodies are not quoted and are read through tools.

### Run state

A Loop run's state is **derived**, never stored: queued, running,
waiting for approval (the agent finished and the task waits in review),
succeeded, failed, canceled, timed out, skipped. The ledger remains the only
writer of run state. Retry is allowed once per run (unique `retry_of`) for
failed, canceled and timed-out runs, re-fires with the same facts and works
the same task.

### Backward compatibility

Migration 257 adds the policy columns with the values that preserve existing
behaviour (`act`, `allow`) and then switches their defaults to the safe ones.
The organization's discovery autopilots are created as `act`/`allow`. All API
changes are additive.

## Consequences

### Positive

- One engine, one history, one set of firing rules for schedules, webhooks,
  events and Run now.
- Exactly-once event firing and per-slot scheduling across replicas.
- A Loop's reach is bounded by its agent and by its mode, on the server.

### Negative

- Every event-triggered run opens its own task (`create_issue`). Running on
  the triggering task instead would move a person's task through
  `in_progress` / `in_review`, so it is not offered.
- Tool calls are workspace-scoped; a project-scoped Loop narrows what fires it
  and where its tasks are filed, not what its tools can read.
- No Slack, initiative, cycle or release triggers; Berry emits no such events.

### Risks and mitigations

- **Risk:** lineage is inferred from runs and tasks, not carried on every
  event. **Mitigation:** inference is conservative (the deepest candidate
  wins), chains are off by default, and the hard limit is 3.
- **Risk:** the outbox is pruned before a receipt is processed.
  **Mitigation:** the receipt fails with `EVENT_GONE` and says so.
- **Risk:** a creation that crashes between opening the task and recording it
  can retry into a second task. This predates Loops (`fire.ts`) and is not
  changed here.

## Validation

- Unit: `autopilots/event-triggers.test.ts`, `run-state.test.ts`,
  `policy.test.ts`, `draft.test.ts`, `organization/enforcement.test.ts`.
- Database: `autopilots/worker.test.ts` (filters, cycles, chains,
  agent-caused events, three workers racing, crash recovery, retry,
  timeouts, tenant isolation, access mode) and `mounts/loops.test.ts`
  (defaults, validation, templates, drafting, paging, cancel/retry, every new
  route refusing another workspace's Loop).

## Follow-up

- Carry the causing run on every outbox envelope so lineage is stated, not
  inferred.
- Notify a Loop's subscribers when one of its runs fails.
- Pull request opened / merged as their own events, once the GitHub
  integration records them.
