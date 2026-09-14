# Berry — Product Brief

*Current direction, revised for ADR-0014*

## What Berry is

Berry is a self-hosted, multi-workspace product where humans and AI coding
agents plan, execute, and review work together. It combines issue and project
management, collaboration, agent configuration, automation, integrations, and
legible run evidence in one browser experience. An assignee can be a person or
an agent, and the same assignment, status, comment, and review primitives
drive both.

Berry is the control plane; it does not run agents in-process and imports no
model SDK ([ADR-0014](adr/0014-agentcore-runtime-control-plane.md)). A run is
dispatched to an AWS Bedrock AgentCore Runtime container (or the same runtime
image reached over HTTP), where a Strands Agents SDK loop calls Amazon
Bedrock models. Berry does not reimplement sandboxing or provider plumbing
beyond that seam.

Berry owns the product motion and its durable facts: users and workspaces,
memberships, issues and projects, collaboration, configuration, the
organization of role agents, review decisions, work proposals, and the
issue-correlated run ledger. Browsers call Berry only; they never receive a
provider credential or call a model provider directly.

## Who it's for

**Primary: software teams that already use coding agents** and are hitting the
coordination ceiling of running them from individual terminals. Their pain:

- Agent work is invisible. Nobody knows what an agent is doing, what it cost, or whether its output was reviewed.
- Hand-offs are manual. A human prompts an agent, copies the result into a PR, and pastes links back into the tracker.
- There is no gate. Agent output lands wherever the agent left it; review is a vibe, not a state.

**Secondary: engineering leads and operators** who want agent throughput with
the accountability of a normal team process: an audit trail, budget visibility,
workspace-level controls, and a human gate before release.

Berry is a self-hosted product: an operator deploys the server against their
own PostgreSQL 16, object storage and AWS account, and one deployment may
contain multiple workspaces. There is no hosted billing or subscription
surface.

## The product motion: issue → agent → review

Berry's core loop mirrors how a team already works, extended to agents:

1. **Issue.** Work starts as an issue with a project, properties, status,
   priority, relationships, and a human or agent assignee.
2. **Assign to an agent.** Berry queues a run and dispatches it to the agent
   runtime with the approved context. Steps, events, usage, and cost are
   correlated back to that run and issue.
3. **Work happens on the issue.** The agent posts progress and results as issue comments; status transitions happen as the work moves, up to *in review* but never past it. A human can interject in the thread, redirect, or take over.
4. **Review gate.** When the agent delivers, the issue moves to *in review*. Nothing ships without a human accepting it. Review is a first-class state with the run's evidence (diff, logs, cost, audit hash) attached — not a comment saying "LGTM". Peer role agents (for example QA, security, or architecture) may add their own blocking or advisory review first; none of them can release the work.
5. **Done & audit.** Human acceptance and Berry workflow history are durable
   product records. Run artifacts are linked as execution evidence; they do not
   replace Berry's run ledger.

The inner loop (issue → agent run → in review) is autonomous up to staging; the **release gate is always human**, enforced in the tools themselves — no agent tool can set an issue to `done` or `cancelled`, and no autonomy level includes a merge tool.

## The organization

Every workspace is provisioned with an Orchestrator and 18 role agents across
product, engineering, quality & security, platform, growth & insight, and
leadership. Each role carries a contract (mission, allowed tools, delegation
targets, escalation path, review domains) and an autonomy level from 1 to 5
that ceilings its effective tools no matter what the contract grants. Roles
review each other's work by domain, can delegate or escalate to another role
or to a human, and can raise work proposals for tasks nobody has created yet
— which either go straight to `todo` under the owning role or wait in the
backlog for a person's decision. Roles with a standing discovery brief get a weekly scheduled look
at the workspace so proposals surface on a cadence.

## Current web platform

The browser-facing server is the TypeScript service described in
[ADR-0009](adr/0009-typescript-product-server.md): Hono for routing,
postgres.js over PostgreSQL, and SSE for live product behavior. The public
interface is Berry's `/api/v1` contract with its error envelope, cursor
pagination, idempotency, authentication, and `camelCase` rules, plus a
smaller public `/v1` API for personal access tokens and plugins.

The server serves identity, workspaces, boards, issues, comments,
dependencies, reviews, goals, projects, attachments, agents, the
organization, work proposals, runs, runtimes, integrations, approvals, the
inbox, conversations, search, saved views, catalogs, plans, and autopilots.
`GET /api/v1/config` reports only the capabilities a given deployment
actually has, so the UI can switch off what is missing.

Desktop and mobile clients are not part of the product. A CLI, a daemon and
its WebSocket, local launchers, provider adapters and filesystem execution
outside the agent runtime are all out of scope; the AgentCore Runtime holds
those execution responsibilities.

## Licensing posture

- **Berry's own code** is developed against permissive licenses only. Every dependency must be MIT / Apache-2.0 (or equivalently permissive); no copyleft in the shipped product.
- **The agent runtime** runs the Strands Agents SDK against Amazon Bedrock; Berry retains upstream notices.
- **Circle** (frontend template origin) is MIT; its notice is retained in the frontend.
- Berry's API uses conventional resource-oriented JSON and pagination. No
  third-party product schema, brand, or marks become Berry product identity.
- Berry's own license and third-party notice file live in the repository root and are kept current as dependencies are added.

---

*Sources: repository code as of ADR-0014; Circle (github.com/ln-dev7/circle), the origin of the frontend template.*
