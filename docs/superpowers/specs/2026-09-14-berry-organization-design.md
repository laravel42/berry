# Berry's default organization: 18 role agents with contracts, autonomy, delegation, reviews and work discovery

- **Date:** 2026-09-14
- **Status:** Draft for review
- **Scope:** server-ts (schema, provisioning, runtime enforcement, tools, review gate, autopilots, API) and frontend (role and organization views)

## 1. Goal

A newly created Berry workspace behaves like a small, complete software company from day one. Every important responsibility is owned by one specialised agent with an explicit contract: what it owns, what it may do, whom it hands work to, who reviews it, and where it escalates. Work flows through explicit delegation, is verified independently, and specialists find worthwhile work on their own and propose it.

The organisation is modelled as a network of responsibilities that Berry **enforces**, not as a set of prompts: autonomy decides which tools a run can reach, delegation is refused outside the graph, blocking reviews are required before the human gate, and discovered work with significant impact waits for a decision.

### Non-goals

- No agent merges or releases. The human release gate stays (AGENTS.md); `merge_without_approval` is granted to no role.
- No external observability integration. SRE and Data & Analytics discover from what Berry can already read: repositories, runs, run failures, usage, tasks.
- No visual org-chart editor. Contracts are editable per agent; the catalog is changed in code.

## 2. Decisions taken

| Question | Decision |
| --- | --- |
| Scope | One spec for all five parts: catalog + contract, autonomy enforcement, delegation graph, domain review authority, work discovery |
| Structure | Catalog in code, contract stored on each agent row (approach A) |
| Existing agents | The protected Orchestrator stays and keeps routing, now with its own contract (`orchestrator`, §7.2); Engineering Manager is an ordinary role agent; Guide stays; model-named fleet agents and the two media agents are archived and no longer seeded |
| Level 5 | Blocking reviewer in its domain. Rejection sends work back; approval is required before the human gate; a person still approves the release |
| Models | Opus 5 for CTO and Software Architect; Sonnet 5 for Product Lead, Engineering Manager, Product Designer, Security, QA and implementation engineers; Haiku 4.5 for Business Analyst, UX Researcher, Technical Writer, Data & Analytics and Growth |
| Discovery start | Schedules seeded **active** in every workspace, weekly, staggered, with quotas and cost guards (§8) |

## 3. Architecture

```
server-ts/src/organization/
  contract.ts      Zod schema for a role contract; the one validator
  catalog.ts       the 18 roles, departments, workflows, prompts; CATALOG_VERSION
  autonomy.ts      level → permission ceiling and tool ceiling
  provision.ts     ensureOrganization(sql, workspaceId): insert, upgrade, archive legacy
  delegation.ts    canDelegate(from, to) over both sides of the graph
  reviews.ts       requiredReviews(issue, run, changedPaths) → [{roleKey, authority}]
  discovery.ts     discovery autopilots per role; proposal fingerprinting
  tools/           delegate_to_agent, escalate, propose_work, submit_review
```

Everything reads the contract from the agent row, validated by `contract.ts`. `catalog.ts` is the source for new rows and for upgrades only; a workspace's agents can diverge from it.

## 4. Data model (migration 186)

**`agents`**

| Column | Type | Notes |
| --- | --- | --- |
| `role_key` | text, nullable | Stable catalog id (`software-architect`). Unique per workspace where not null and not archived |
| `role_contract` | jsonb, nullable | Full contract (§5). `octet_length ≤ 65536`; shape validated in the server |
| `contract_version` | integer, nullable | Catalog version the row was last written from |
| `contract_hash` | text, nullable | Hash of what Berry last wrote, to detect a person's edits |
| `autonomy_level` | smallint, nullable | 1–5; mirrors the contract, read on every tool call |

`agents_system_role_ck` is unchanged (Guide only). The Orchestrator keeps `protected = true` and gains `role_key = 'orchestrator'`; the Engineering Manager is an ordinary, unprotected agent.

**`work_proposals`** (new)

| Column | Type | Notes |
| --- | --- | --- |
| `id`, `workspace_id` | uuid | |
| `issue_id` | uuid → issues | The backlog task created for the proposal |
| `proposed_by` | uuid → agents | |
| `role_key` | text | Proposing role |
| `problem`, `impact`, `proposed_action` | text | Required, each ≤ 4000 chars |
| `evidence` | jsonb array | `[{kind: 'file'|'run'|'dependency'|'metric'|'task'|'url', ref, excerpt}]`, 1–20 items |
| `severity` | text | `critical` \| `high` \| `medium` \| `low` |
| `impact_classes` | text[] | Any of `product`, `security`, `architectural`, `financial`, `operational`, `routine` |
| `effort` | text | `xs` \| `s` \| `m` \| `l` \| `xl` |
| `dependencies` | text[] | Free text or task identifiers |
| `responsible_role` | text | Owning role key |
| `required_reviewers` | text[] | Role keys |
| `fingerprint` | text | Dedupe key; unique per workspace among open proposals |
| `status` | text | `proposed` \| `accepted` \| `rejected` \| `superseded` |
| `decided_by`, `decided_at` | | Person, or null for an auto-accept (§8.4) |

**`approvals.kind`** gains `work_proposal` and `escalation`.

The Orchestrator and Guide triggers are unchanged: workspace insert still creates both, and `ensureOrganization` adds the Orchestrator's contract (§10).

**`issue_auto_reviews`** changes from one peer review per run to many required reviews:
- drop `UNIQUE (run_id)`; add `UNIQUE (run_id, reviewer_id)`
- add `reviewer_role` text and `authority` text (`blocking` \| `advisory`)
- `issue_auto_reviews_peer_ck` stays: nobody reviews their own run

## 5. The role contract

```ts
RoleContract = {
  id: string                     // role key
  name: string                   // display name, "Software Architect"
  role: string                   // "Principal Software Architect"
  department: 'operations' | 'product' | 'engineering' | 'quality-security' | 'platform' | 'growth-insight' | 'leadership'
  mission: string
  responsibilities: string[]
  capabilities: string[]         // routing tags, also written to agents.capabilities
  allowed_tools: ToolName[]      // must exist in the tool registry (test-enforced)
  preferred_model: string        // Bedrock inference profile id
  inputs: string[]
  outputs: string[]
  can_delegate_to: RoleKey[]
  receives_work_from: RoleKey[]
  escalation_rules: { when: string; to: RoleKey | 'human'; decision: 'product' | 'technical' | 'security' | 'operational' }[]
  review_requirements: { reviewer: RoleKey; authority: 'blocking' | 'advisory'; when: ReviewCondition }[]
  autonomy_level: 1 | 2 | 3 | 4 | 5
  review_domains: string[]       // Level 5 only: what its blocking reviews cover
  discovery: { cron: string; focus: string[]; evidence_sources: string[] } | null
  run_limits: { max_turns: number; max_output_tokens: number }   // written to agents.manifest_limits
  never: string[]                // hard prohibitions rendered into the prompt ("Never implement production code")
  system_prompt: string          // ≤ 20000 chars (agents_instructions_length_ck)
}

ReviewCondition = {
  labels_any?: string[]          // issue labels
  paths_any?: string[]           // globs over the run's changed paths
  impact_any?: string[]          // proposal impact classes
  always?: true
}
```

`agents.instructions` = `system_prompt`. `agents.capabilities` = `capabilities`. `agents.model_name` = `preferred_model` at creation.

Catalog validation (unit tests, run in `pnpm test:server`):
- every `can_delegate_to` edge has the reverse `receives_work_from` edge
- every tool in `allowed_tools` exists and is within the role's autonomy ceiling (§6)
- every reviewer and escalation target is a role in the catalog, or `human`
- no role reviews itself; Level 5 roles have non-empty `review_domains`
- prompts contain the role's title, mission and prohibitions, and are ≤ 20000 chars
- at most five roles at Level 5

## 6. Autonomy and enforcement

### 6.1 Ceilings

| Level | Name | Permissions ceiling | Tool ceiling (cumulative) |
| --- | --- | --- | --- |
| 1 | Advisory | `read_repository` | `read_task`, `list_dependencies`, `read_file`, `list_files`, `read_project_resources`, `post_comment`, `escalate` |
| 2 | Contributor | + none | + `write_file` (artifacts), `attach_file`, `create_task`, `create_project`, `set_status`, `propose_work`, `delegate_to_agent`, `mention_agent` |
| 3 | Executor | + `create_branches`, `run_commands`, `open_pull_requests` | + `run_command`, `collect_file` |
| 4 | Autonomous | same as 3 | same as 3, plus the auto-accept rule for its own proposals (§8.4) |
| 5 | Authority | same as 3 | same as 3, plus `submit_review` with blocking authority in `review_domains` |

The level is a **ceiling**. An agent's effective tools are `allowed_tools ∩ ceiling(level)`; its effective permissions are the ceiling filtered to what its tools need. So the Product Lead is Level 5 but has no `run_command` in `allowed_tools` and therefore no code permissions — it can never implement production code. `merge_without_approval` is not in any ceiling.

### 6.2 Enforcement points

1. **Runtime**: the task envelope's agent section gains a new `tools` field with the agent's effective tool list (distinct from the existing per-MCP-server `allowedTools`). `PermissionPlugin` refuses any Berry or local tool not in that list, before its existing `TOOL_PERMISSIONS` check. A refusal is returned as the tool result, as today.
2. **Berry tool API**: `/api/v1/agent-tools/*` re-checks the calling task's agent against the same effective list. The runtime is not trusted to have filtered.
3. **Repository work**: `repository-run.ts` keeps requiring `create_branches`/`read_repository`, now derived from the level.
4. **Contract edits**: `PUT /api/v1/agents/:id/contract` refuses a contract whose tools exceed its level's ceiling, or a level of 5 for a role without `review_domains`.

## 7. Delegation, routing, escalation

### 7.1 Tools

- **`delegate_to_agent`** `{ role | agentId, title, description, acceptanceCriteria[] }`: creates a sub-task of the current task assigned to the target and queues its run. Allowed only when the caller's role lists the target in `can_delegate_to` **and** the target lists the caller in `receives_work_from`. Replaces squad-leader-only delegation for org agents; `delegate_to_member` stays for squads.
- **`escalate`** `{ to: 'cto' | 'product-lead' | 'human', decision, question, options[], recommendation }`: creates an `approvals` row of kind `escalation` (human) or a delegated decision task to the CTO/Product Lead, and moves the current task to `blocked` until it is answered.
- **`mention_agent`**: stays for asking a question without handing over work.

### 7.2 The Orchestrator routes; the Engineering Manager coordinates execution

**Orchestrator** (protected, `role_key = 'orchestrator'`, department `operations`, Level 2, Sonnet 5, no discovery). It stays the workspace's intake and router, and keeps every job it has today: plan triage (`plans/triage.ts`), the identity single model calls run under (`runtime/completion.ts`), and the fallback for work nobody else holds. Its contract adds:
- `can_delegate_to`: every role in §12 — it hands a piece of work to the first owner of the workflow it selects.
- `receives_work_from`: none (work arrives from people, plans, autopilots and integrations).
- `never`: implement, review, or decide product or technical questions itself; it routes and escalates.

The catalog adds `orchestrator` to every role's `receives_work_from` when it builds contracts, so the symmetry rule (§5) holds without listing it in each row of §12.

Triage now gives the Orchestrator the roster **with contracts** (role, mission, capabilities, autonomy, delegation lists) and the catalog's workflows. It answers with an assignment per task — the first role of the selected workflow — and the workflow name, recorded on the task so later hand-offs follow it. Assignments to agents that are not on the roster are dropped, as today.

**Engineering Manager** (ordinary agent) takes over once a goal is approved: it converts it into executable tasks, assigns specialists within its delegation list, tracks blockers and dependencies, detects conflicting work and requests reviews. It does not implement.

### 7.3 Workflows

`catalog.ts` holds named workflows the Orchestrator selects from dynamically at intake, and the Engineering Manager follows during execution; no workflow requires every role.

| Workflow | Chain |
| --- | --- |
| `new-product-feature` | Product Lead → Business Analyst → Product Designer → Software Architect → Engineering Manager → implementation → QA |
| `full-delivery` | Product Lead → Business Analyst → Product Designer → Software Architect → Engineering Manager → implementation → QA → Security (if applicable) → code review (the §9 required reviews) → DevOps → SRE → Data & Analytics → Product Lead validation |
| `frontend-visual-bug` | Frontend Engineer → QA |
| `authentication-system` | Product Lead → Software Architect → Security → Backend → Frontend → QA → DevOps |
| `database-performance` | SRE → Database Engineer → Backend Engineer → QA |
| `production-incident` | SRE → relevant specialist → Security (if security-related) → postmortem (SRE) |

## 8. Work discovery

### 8.1 Schedules

`ensureOrganization` creates one autopilot per role that has `discovery`, assigned to that agent, `execution_mode = 'fixed_issue'` on a per-role "Discovery: <role>" task, **status `active`**, weekly cron staggered across weekdays and hours so no two roles fire in the same hour, `quota_period = 'week'`, `quota_max = 1`.

### 8.2 The discovery run

The prompt template renders the role's `discovery.focus` and `evidence_sources` and instructs: inspect the project from this profession's perspective; file at most **five** findings with `propose_work`; file nothing without evidence; stop when nothing is worth proposing.

Focus by role (abbreviated): Security → vulnerable dependencies, secrets, authz gaps; QA → untested critical flows; SRE → recurring run failures and error patterns; Database → slow or unindexed queries, risky migrations; Product Designer → inconsistent interaction patterns; Technical Writer → outdated docs; Growth → indexing and technical SEO; Architect → duplicated services, wrong boundaries; Product Lead → goals without acceptance criteria; Engineering Manager → blocked or ownerless work; CTO → systemic risk across proposals.

### 8.3 `propose_work`

Input is the proposal record from §4 minus ids and status. The tool:
1. validates evidence (1–20 items), severity, impact classes, reviewers and responsible role against the catalog
2. computes `fingerprint = sha256(role_key + normalised problem + sorted evidence refs)` and returns the existing proposal if an open one matches
3. creates a `backlog` task, unassigned, labelled `proposal` plus the role's department label, with the proposal rendered in the description
4. writes the `work_proposals` row
5. decides per §8.4

### 8.4 Accept rules

- **Needs a decision** (an `approvals` row of kind `work_proposal`, requested from `admin`) when any impact class is `product`, `security`, `architectural`, `financial` or `operational`, when severity is `critical` or `high`, or when the proposer is below Level 4.
- **Auto-accepted** only when impact is exactly `routine`, severity is `low` or `medium`, and the proposer is Level 4 or 5: the task is assigned to `responsible_role` and moved to `todo`. It still goes through §9 reviews and the human release gate.
- Accepting a proposal assigns the task to `responsible_role` and moves it to `todo`; rejecting it archives the task and records the reason.

### 8.5 Cost guards

- Workspace switch `settings.organization.discovery` (default `true`); when false, discovery autopilots are skipped at fire time.
- A discovery run is skipped before queueing when the workspace has no project with a linked repository and no tasks — nothing to inspect, nothing spent.
- Per-run limits from each role's `run_limits` (written to `manifest_limits`). Defaults: Opus roles 20 turns / 8k output tokens per turn; Sonnet roles 40 / 8k; Haiku roles 30 / 4k.
- Weekly quota of one run per role (§8.1); five proposals per run (§8.2).

## 9. Reviews and Level 5 authority

When a run delivers (opens a PR or completes a task), `requiredReviews()` evaluates every Level 5 and advisory reviewer rule against the task's labels, the run's changed paths and any proposal impact classes. Defaults in the catalog:

| Reviewer | Authority | When |
| --- | --- | --- |
| QA Engineer | blocking | always, for output of Level 3/4 implementation roles |
| Security Engineer | blocking | labels `security`; paths `**/auth/**`, `**/integrations/**`, `**/*secret*`, `**/Dockerfile`, `.github/**`, `**/iam/**`; proposal impact `security` |
| Software Architect | blocking | label `architecture`; paths `server-ts/src/index.ts`, `**/migrations/**` (with Database), new top-level service directories; proposal impact `architectural` |
| Database Engineer | advisory | paths `**/migrations/**`, `**/*.sql` |
| Product Designer | advisory | labels `design`; frontend component paths |
| Product Lead | blocking | tasks in the `full-delivery` workflow at validation, and proposal impact `product` |
| CTO | blocking | escalations of kind `technical`, and proposals with impact `architectural` + severity `critical` |

Each required review is an `issue_auto_reviews` row. The existing ReviewGate runs each reviewer as a completion with its own model and domain prompt.
- Any **blocking rejection** moves the task to `todo` with the findings, and the author gets another run (bounded by `BERRY_AUTOGATE_MAX_ATTEMPTS`).
- When every blocking review approves, the task moves to `in_review` for a person. It is **never** moved to `done` by an agent.
- Security findings must carry `severity`, `exploitability`, `impact` and `remediation`; the verdict schema requires them for the Security reviewer and the gate rejects a verdict without them.
- QA reviews independently: its prompt receives the acceptance criteria, the diff and check results, not the author's summary as a verdict.

The current plan-level AutoGate opt-in becomes "use the organisation's required reviews"; its "approved → done" transition is removed for org workspaces.

## 10. Provisioning and migration

`ensureOrganization(sql, workspaceId)` is idempotent, keyed on `role_key`:

1. Insert each missing role from the catalog: name, description (mission), instructions, capabilities, `preferred_model`, contract, version, hash, level, permissions derived from §6, runtime unbound (workspace default applies).
2. Give the existing protected Orchestrator (created by the workspace trigger) `role_key = 'orchestrator'`, its contract, level and permissions. Its instructions are replaced only if they still hold exactly migration 184's text; otherwise its current instructions stay and it is marked customised. It stays protected; nothing about the protection triggers changes.
3. For each existing role whose `contract_version < CATALOG_VERSION`: if `contract_hash` matches the stored contract, replace it with the new catalog entry; otherwise keep it and mark the agent customised.
4. Archive agents created by the fleet seed (instructions beginning "You are … one of a fleet of agents") and the `text-to-speech` / `text-to-video` media agents.
5. Create or update discovery autopilots (§8.1).

Call sites: workspace creation (`identity/workspaces.ts`, same transaction, after the insert trigger has created the Orchestrator and Guide), the development seed, and server boot for every workspace (best effort, logged like `syncPlatformRuntime`), which also covers workspace rows inserted outside the server. `seed:agents` (the model fleet) is removed.

## 11. API and UI

**API**
- `GET /api/v1/agents` and `/agents/:id` add `roleKey`, `department`, `autonomyLevel`, `customized`, and `contract` (full on detail, summary on list).
- `GET /api/v1/organization` returns departments, roles with their agents, the delegation graph, workflows and discovery state per role.
- `PUT /api/v1/agents/:id/contract` (`settings.write`) validates and saves a contract; `POST /api/v1/organization/roles/:roleKey/reset` restores the catalog version.
- `PUT /api/v1/organization/discovery` toggles the workspace switch; per-role pause/resume uses the existing autopilot routes.
- `GET /api/v1/work-proposals` (filter by status, role, severity) and `POST /api/v1/work-proposals/:id/accept|reject`.

**Frontend**
- Agent detail gains a **Role** tab: mission, responsibilities, inputs/outputs, delegation (in and out, linked), escalation, required reviews, autonomy level with what it allows, discovery schedule, and a "customised — reset to Berry's version" action.
- Settings → **Organization**: agents grouped by department, autonomy badges, the delegation graph as a list, discovery on/off per role and for the workspace.
- A **Proposals** view under Work: proposals with problem, evidence, severity, impact, effort, owner and reviewers; accept/reject.
- All strings in en, ja, ko and zh-Hans (`scripts/check-locale-catalogues.py`).

## 12. The organisation

| # | Role key | Department | Level | Model | Delegates to | Receives from | Discovery |
| --- | --- | --- | --- | --- | --- | --- | --- |
| 1 | `product-lead` | product | 5 | Sonnet 5 | business-analyst, ux-researcher, product-designer, software-architect, engineering-manager, growth-engineer, data-analytics-engineer, technical-writer | engineering-manager, cto, growth-engineer, data-analytics-engineer, ux-researcher | goals without acceptance criteria, roadmap gaps |
| 2 | `business-analyst` | product | 2 | Haiku 4.5 | product-designer, software-architect | product-lead | ambiguous or conflicting requirements |
| 3 | `ux-researcher` | product | 2 | Haiku 4.5 | product-designer, product-lead | product-lead, product-designer | usability risks in flows |
| 4 | `product-designer` | product | 2 | Sonnet 5 | frontend-engineer, ux-researcher | product-lead, business-analyst, ux-researcher, frontend-engineer | inconsistent interaction patterns, accessibility |
| 5 | `software-architect` | engineering | 5 | Opus 5 | engineering-manager, database-engineer, security-engineer, backend-engineer, integration-engineer, technical-writer | product-lead, business-analyst, engineering-manager, cto, sre | duplicated services, boundary violations |
| 6 | `backend-engineer` | engineering | 4 | Sonnet 5 | qa-engineer, database-engineer, security-engineer | engineering-manager, software-architect, sre, database-engineer, qa-engineer, security-engineer | backend test gaps, performance hotspots |
| 7 | `frontend-engineer` | engineering | 4 | Sonnet 5 | qa-engineer, product-designer | engineering-manager, product-designer, qa-engineer, security-engineer, growth-engineer | frontend test and accessibility gaps |
| 8 | `database-engineer` | engineering | 3 | Sonnet 5 | backend-engineer, qa-engineer | software-architect, engineering-manager, sre, backend-engineer, qa-engineer | slow queries, missing indexes, risky migrations |
| 9 | `integration-engineer` | engineering | 3 | Sonnet 5 | qa-engineer, security-engineer | engineering-manager, software-architect, qa-engineer, security-engineer | brittle integrations, missing retries/idempotency |
| 10 | `qa-engineer` | quality-security | 5 | Sonnet 5 | backend-engineer, frontend-engineer, database-engineer, integration-engineer | engineering-manager, backend-engineer, frontend-engineer, database-engineer, integration-engineer, devops-engineer | untested critical flows |
| 11 | `security-engineer` | quality-security | 5 | Sonnet 5 | backend-engineer, frontend-engineer, devops-engineer, integration-engineer | software-architect, engineering-manager, backend-engineer, integration-engineer, sre, devops-engineer | vulnerable dependencies, secrets, authz gaps |
| 12 | `devops-engineer` | platform | 3 | Sonnet 5 | sre, security-engineer, qa-engineer | engineering-manager, security-engineer, sre | CI/CD friction, unpinned or unreproducible builds |
| 13 | `sre` | platform | 4 | Sonnet 5 | database-engineer, backend-engineer, security-engineer, devops-engineer, software-architect | engineering-manager, devops-engineer | recurring run failures and error patterns |
| 14 | `data-analytics-engineer` | growth-insight | 3 | Haiku 4.5 | product-lead, growth-engineer | product-lead, growth-engineer, engineering-manager | missing instrumentation, unmeasured features |
| 15 | `technical-writer` | growth-insight | 3 | Haiku 4.5 | — | engineering-manager, software-architect, product-lead | outdated or missing documentation |
| 16 | `growth-engineer` | growth-insight | 3 | Haiku 4.5 | data-analytics-engineer, product-lead, frontend-engineer | product-lead, data-analytics-engineer | indexing problems, activation drop-offs |
| 17 | `engineering-manager` | engineering | 2 | Sonnet 5 | product-lead, software-architect, backend-engineer, frontend-engineer, database-engineer, integration-engineer, qa-engineer, security-engineer, devops-engineer, sre, data-analytics-engineer, technical-writer, cto | product-lead, software-architect | blocked or ownerless work, missing completion criteria |
| 18 | `cto` | leadership | 5 | Opus 5 | software-architect, engineering-manager, product-lead | software-architect, engineering-manager | systemic technical risk across proposals |

The delegation lists above are the catalog's source and satisfy the symmetry rule in §5: every "delegates to" edge appears as the reverse "receives from" edge. Reaching the CTO or Product Lead for a *decision* is escalation (`escalate`, §7.1), not delegation, so roles such as Security and SRE escalate to the CTO without a delegation edge.

Plus the **Orchestrator** (`orchestrator`, operations, Level 2, Sonnet 5): delegates to every role above, receives from none, no discovery (§7.2).

Level distribution: Level 5 — Product Lead, Software Architect, QA, Security, CTO (five); Level 4 — Backend, Frontend, SRE; Level 3 — Database, Integration, DevOps, Data & Analytics, Technical Writer, Growth; Level 2 — Business Analyst, UX Researcher, Product Designer, Engineering Manager, Orchestrator; Level 1 — none by default (available for customised roles).

### 12.1 System prompt template

Each role's prompt is written in full in `catalog.ts`, following this structure and never the generic "helpful assistant" phrasing:

```
You are the <role> at <workspace>. <One-sentence ownership statement>.

Mission: <mission>

You are responsible for:
- <responsibility> …

You produce: <outputs>. You work from: <inputs>.

Before acting: <profession-specific analysis — e.g. the Architect reads requirements, repository structure, dependencies and operational constraints>.

You never: <prohibitions — e.g. "implement production code", "approve your own work", "merge">.

Hand work to <can_delegate_to> with delegate_to_agent, with acceptance criteria.
Escalate with escalate: <escalation rules>.
Your work is reviewed by: <review requirements>.
<Level 5 only>: You review <review_domains>. A rejection must state findings with evidence; an approval must state what you verified.
When you find worthwhile work outside your task, file it with propose_work; do not silently execute changes with product, security, architectural, financial or operational impact.
If you have no tool for what is asked, say so plainly — never describe an action as done.
```

Example (Software Architect): "You are the Principal Software Architect. You are responsible for the structural integrity of the software system. You analyze requirements, repository structure, dependencies and operational constraints before recommending architectural changes. You do not implement features unless explicitly requested. Major architectural decisions must be recorded as ADRs."

## 13. Error handling

- A contract that fails validation on read (a hand-edited row) is treated as **Level 1 with read-only tools** and logged; the agent detail shows "contract invalid".
- `delegate_to_agent` outside the graph, `submit_review` outside a domain, and tools over the ceiling return a refusal sentence as the tool result, never an HTTP 500.
- Provisioning failures at boot are logged per workspace and do not stop the server; workspace creation fails the transaction if provisioning fails, so no workspace exists without its organisation.
- A reviewer that cannot run (model error) records the review as not decided and leaves the task in `in_review` with a visible note, as the gate does today — never as an approval.
- Duplicate proposals return the existing proposal id.

## 14. Testing

- **Catalog** (offline): the §5 validation rules, level distribution, model ids are Bedrock inference profiles, every prompt renders its prohibitions.
- **Provisioning** (database): a new workspace gets the 18 roles, the Orchestrator (still the one protected agent, now with its contract) and the Guide; the Engineering Manager is not protected; running twice changes nothing; an Orchestrator with edited instructions keeps them; a customised contract is not overwritten on upgrade; legacy fleet and media agents are archived; discovery autopilots are active, staggered and quota-limited.
- **Enforcement**: a Level 2 agent's `run_command` is refused in the runtime and at the tool API; Product Lead has no code permissions despite Level 5; contract edits over the ceiling are refused.
- **Delegation**: allowed edge queues a sub-task; one-sided or absent edge is refused; `escalate` blocks the task and creates the right approval or decision task.
- **Reviews**: `requiredReviews` table tests over labels and paths; a blocking rejection returns the task to `todo`; all approvals land in `in_review`, never `done`; Security verdict without exploitability is rejected.
- **Discovery**: fire skips with the workspace switch off and when there is nothing to inspect; `propose_work` dedupes by fingerprint; accept rules (§8.4) as a table test.
- **Routing**: triage still uses the Orchestrator's model, receives contracts and workflows, records the selected workflow on each task, and drops assignments to agents not on the roster.
- **Frontend**: lint, `build:check`, locale catalogue check, and a manual check of Role tab, Organization settings and Proposals.

## 15. Delivery order

1. Contract schema, catalog with all 18 roles and prompts, catalog tests.
2. Migration 186, `ensureOrganization`, the Orchestrator's contract, legacy archive, seed changes.
3. Autonomy ceilings and the three enforcement points.
4. `delegate_to_agent`, `escalate`, triage on contracts and workflows.
5. Required reviews and Level 5 authority in the ReviewGate.
6. `work_proposals`, `propose_work`, accept rules, discovery autopilots and cost guards.
7. API routes.
8. Frontend: Role tab, Organization settings, Proposals view, locales.

Each step leaves the server test suite green and is independently reviewable.
