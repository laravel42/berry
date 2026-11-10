# Berry

**One task tracker for people and AI agents, where a person always makes the final call.**

Berry is a self-hosted workspace where a team and its AI agents share one task tracker. A task goes to a person or to an agent. An agent that gets a task reads it, writes code, runs checks and opens a pull request. Then a person looks at the result and decides. Assigning, discussing, reviewing and closing work look the same whoever did it.

Berry is built on one idea: **agents work for people, not around them.** Agents can plan, build, review each other and propose new work. They can't release their own work. No agent tool can mark a task done or cancelled, and no autonomy level includes a merge tool. A person releases work, either one task at a time in Reviews or once for a whole plan with AutoGate.

## Words used throughout

- **Task.** A unit of work: a title, a description, a status, an assignee. The code calls these "issues".
- **Agent.** An AI worker with a name, instructions, a model tier, skills and permissions. You assign it tasks, mention it and chat with it like a teammate.
- **Run.** One attempt by an agent at a task: queued, running, then finished, failed or cancelled. Every step is recorded.
- **Runtime.** Where runs happen: a connected AI runtime (a subscription CLI, an API token or LM Studio) on an AgentCore or HTTP compute host.
- **Tier.** A class of models an agent runs on: Max, XHigh, High, Mid or Low. An admin places connected models on each tier.

> **Needs setup** notes say what a feature requires. Berry reports its own abilities honestly: `GET /api/v1/config` lists only what this deployment can actually do, and the app switches off the rest.

---

## 1. Work tracking

**Tasks.** A task has a title, a plain-text description saved exactly as typed, a status, a priority, an assignee, a project, a start date, a due date, a cycle, labels and any custom fields the workspace defines. You create one from the Tasks page, from the add row in the table view or from the command palette. The create dialog either lets you write the task yourself or hand it to an agent, with *Improve with AI* to rewrite your draft.

**Statuses.** Backlog, todo, in progress, in review, done, blocked and cancelled. Priority is none, urgent, high, medium or low. A person can move a task to any status. An agent can move one only as far as *In review* or *Blocked*.

**People or agents.** The assignee picker lists members and agents side by side. Assigning a task to an agent can start a run at once (*Assign and start*) or leave it waiting. Assigning a task that's already in Todo to an agent starts the agent automatically.

**Structure.** Tasks can have sub-tasks, with done-out-of-total progress and numbered stages that hold later stages back. *Blocked by* dependencies are checked for loops. When everything a task waits on is finished, Berry moves the task to Todo and starts its agent.

**Labels, custom fields and attachments.**
- **Labels** are workspace-wide and also steer reviews; for example, *security* brings in a security reviewer.
- **Custom fields** can be text, number, yes/no, date, link, or single or multi-select. They can be archived and restored.
- **Attachments** upload to S3 or any S3-compatible store, up to 25 MB by default.

**Conversation.** Tasks have threaded comments, reactions and **@**-mentions. Mentioning an agent starts its run; *note* mode wakes no one. An activity history records who changed what, person or agent.

**Views.** Five layouts of the same tasks:
- **List**
- **Board:** drag tasks between lanes.
- **Table:** choose columns, export to CSV, show totals.
- **Swimlanes**
- **Gantt:** drag a bar to change its due date.

Group, sort and choose card fields from *Display*. Filter by scope, status, priority, people, project, label, date or custom field. Save any combination as a private or shared view, pin it to the sidebar, and get warned before you overwrite someone else's changes to a shared view.

**Cycles.** Workspace timeboxes: upcoming, active (one at a time) and completed. Each task belongs to at most one cycle; you can pick it on the task or in the task list's cycle selector. The Cycles page shows a timeline and a burn-up chart of tasks done per day against the cycle's scope. Each cycle opens in a drawer.

**Projects and milestones.** A project groups tasks under a status, health, lead, members, start and target dates and a linked repository. Milestones are the stages you write for a project, in your own order. Each one's progress is the share of its tasks that are done. From a project's brief, Berry can generate milestones and tasks for you to review.

**Finding things.** The command palette searches tasks (also by key, such as BER-4), projects, people, agents and skills, and runs commands. You also have personal sidebar pins, My tasks, and remappable keyboard shortcuts. The Inbox collects notifications for work you follow: mentions, assignments, reviews, and runs that finished or failed.

---

## 2. Planning and automation

**Plan it.** Describe a goal in one sentence and Berry drafts a plan: milestones, tasks with dependencies, and the tasks that need a person's approval before an agent starts. When the request is ambiguous, Berry asks a blocking question with concrete options instead of guessing. Ordinary code checks every plan's structure and rates its risk. Nothing reaches a board until a person starts the plan.

> Needs setup: a connected AI runtime on the planner's tier.

**Routing.** After a plan starts, the Orchestrator assigns each task to the agent that fits best, and can tag it with a named workflow, a chain of roles. Berry only accepts agents and tasks that exist. A task it can't place stays unassigned.

**AutoGate.** A per-plan choice made before the plan runs. With AutoGate off (the default), every finished task waits for a person in Reviews. With it on, the person consents in advance: each task is released once every blocking review its author's role requires has approved. Berry merges the pull request and marks the task done. A rejection sends the task back to its author, up to a small attempt limit, and then leaves it for a person. An inconclusive review never counts as approval. The agents still have no tool that merges or closes work; the release follows from the person's consent.

**Loops.** A Loop is a standing instruction one agent carries out. Each firing is a run that opens its own task, or works one standing task, and its output waits in review like any agent work. Loop triggers:
- **Schedule:** hourly, daily, weekly, monthly or raw cron, in your time zone, with the next fire time shown.
- **Berry event:** a task created, changing status, assigned or completed; a comment; a project change; a run succeeding or failing; an approval requested. Up to eight *Only if* conditions, matched all or any.
- **Pull request:** a linked pull request changes, filtered by state (open, draft, merged, closed).
- **Webhook:** a signed URL. The secret can be revealed, copied and rotated, and Berry shows a ready `curl` example.
- **Manual:** only *Run now*.

You create a Loop by describing it in a sentence, or from one of nine templates, from bug triage to release notes, each suggesting an agent by role. Nothing is created until you review the Loop and press Create; it can be created paused.

Limits:
- **Ask before acting** keeps the agent to reading, commenting and proposing. It is the default.
- **One run at a time.**
- **Time limit:** a run that goes over is cancelled as *Timed out*.
- **Turn limit:** not yet enforced on subscription CLI runtimes.
- **Answer events caused by agents.**
- **Chain depth.**

A Loop never answers its own runs. Its page shows run history, versions, events it heard and why each fired or was skipped, plus retry and cancel. You can pause, duplicate and archive a Loop.

> Needs setup: an agent with a connected AI runtime. Webhook secrets need the server's encryption key.

**Quick actions.** Saved prompts the workspace defines once, such as "Summarise this discussion", that members run against a task in one click. A prompt may use only the task's key, title and description as placeholders. Berry refuses to save one with any other placeholder.

---

## 3. Agents

**The roster.** The Agents page shows each agent's availability, workload, runtime health, a seven-day chart of runs against failures, model and owner. You can filter, sort, and archive or bind agents to a runtime in bulk.

**Adding agents.** You can add an agent in three ways:
- Add a role from the **Agent catalog**.
- Describe the agent and let Berry draft its name, description and instructions in a conversation.
- Fill in a form yourself.

Copying an agent duplicates its instructions and skills. Archiving keeps its history; there is no hard delete.

**An agent's page** has General (name, tier, runtime, access), Instructions (written in sections), Role and Permissions, Skills, MCP servers and Usage tabs. Edits are a draft until you save, and apply from the next run.

**Skills** are reusable packs of instructions and knowledge. You can write them in the app, or import them from GitHub or a zip file and update them from their source later. The **Skills catalog** offers ready ones, and every catalogue role ships with eight.

**MCP servers** give agents external tools. A server can be shared across the workspace or belong to one agent, connects over streamable HTTP or SSE, and can carry encrypted headers.

**Chat and voice.** You can chat one-to-one with any agent on the Chat page or in the floating window. Bring tasks and projects in with **@**, queue messages, or stop a reply. Members can also talk to an agent by voice in a LiveKit room.

> Needs setup: voice needs `LIVEKIT_URL`, `LIVEKIT_API_KEY` and `LIVEKIT_API_SECRET`.

**Runs.** Each run keeps an ordered event log, and its status updates live on the board. Berry refuses a second run while one is active on the same task. You can cancel a run, and Berry says so if it had already ended. A run that changed files shows its branch, its diff stats and its pull request. The agent's final message is posted as a comment on the task.

**Usage** shows what's running now, spend by agent and by model (an unpriced model is flagged rather than given a made-up cost), and run outcomes and failure rate.

**Models and tiers.** An agent picks a tier. A run uses the first connected model on that tier, unless the task or project pins one. Connect AI runtimes under Settings → AI runtimes:
- **Subscription CLIs** already signed in on the workstation: Kiro, Claude Code, Codex, Cursor, Kimi, Grok and Qoder. Berry never reads their credential stores and never falls back to API billing.
- **API tokens** for OpenAI, Grok, Claude and Gemini, sealed on save.
- **LM Studio** by server address, for local models.

Then place their models on tiers under Settings → Model tiers.

> Needs setup: without a model on the agent's tier, runs and completions are refused. There is no native Bedrock or Kilo path.

---

## 4. The agent organization

**Who's in it.** Every workspace starts with one agent: the **Orchestrator**. Its only job is to route work. It's locked, so it can't be edited, copied or archived. The catalogue holds 95 more roles, eight per department across software, product, design, data, security, operations, marketing, sales, people, finance, legal and research. An owner or admin adds roles from the Agent catalog or Settings → Organization.

A review owed by a role the workspace doesn't have is skipped, and a person still releases the work. Each role carries:
- a contract: mission, tools, hand-off targets and escalation path
- a recommended tier
- its required reviewers
- an autonomy level

**Autonomy levels** are checked when a tool is called, not just written in the instructions:

| Level | Can |
|---|---|
| 1 Advisory | Read, comment, escalate. |
| 2 Contributor | Also write files, create and hand off tasks, change status, propose work. |
| 3 Executor | Also run commands, so it can change code and open pull requests. |
| 4 Autonomous | Level 3 tools, trusted to have low-risk routine proposals accepted automatically. |
| 5 Authority | Also submit a review verdict in its own area. |

An invalid contract falls back to Level 1. Agents created by hand have no level; their permissions govern what they can do in a repository.

**Hand-offs and escalation.** From Level 2, a role can hand a sub-task with acceptance criteria to a role on its list. It can also escalate a product, technical, security or operational decision to a lead role or to a person. Escalating to a person creates a pending approval with the options and the agent's recommendation, and blocks the task until someone answers.

**Required reviews.** Berry works out every role's reviewers itself; they can't be edited:
- **Reviewer:** blocks on every role that writes code.
- **Security reviewer:** blocks when the *security* label is set or sensitive areas change.
- **Architecture reviewer:** blocks on structural areas such as migrations.
- **Database and design reviewers:** advisory only.

A reviewer never approves its own run, and a rejection must cite evidence.

**Proposals and discovery.** From Level 2, roles file work they discovered, with evidence and severity. Only low-risk routine work from Level 4 or 5 is accepted automatically; the rest waits on the Proposals page. *Work discovery* is off by default; switched on, each role takes a weekly look at the workspace.

**Named workflows.** Six built-in role chains describe the shortest path for common work, such as a new feature or a production incident.

---

## 5. Review, approvals and delivery

**Reviews.** Reviews lists every task an agent delivered that waits for a person, with the pull request, diff, agent's summary, checks and verdicts on one screen. *Accept* merges the pull request and moves the task to Done. If the branch conflicts with its base, the task goes back to its agent to resolve. *Decline* needs a note, which the agent reads on its next run, and returns the task to Todo. After a merge, Berry brings the repository's other open Berry pull requests up to date.

**Approvals.** A queue of yes-or-no decisions that must come first: starting a flagged task, a proposal, an escalation. Each one has a risk rating and is addressed to a person or a role. Only that addressee, or someone more senior, can decide it.

**Delivery.** Before finishing, a run writes a handoff at `.handoffs/<task key> - <slug of the title>`, which tasks waiting on this one read. The runtime's own delivery step pushes the branch, not the model, with a push that won't overwrite newer work. Berry then opens the pull request, titled with the task key. Its description holds the agent's summary and a verification report. A run that changed nothing opens no pull request.

**Source control.**
- **GitHub:** a GitHub App that Berry creates through GitHub's manifest flow, with a short-lived installation token for each run.
- **GitLab:** connects with a pasted access token, sealed on save.
- **Bitbucket:** listed but not yet connectable.

Settings → Repositories holds the repositories this workspace actually works in. You can paste a link or import a repository; each project links to one.

> Needs setup: the server's encryption key, and an installed GitHub App or a GitLab token that can push.

---

## 6. Workspace and administration

**Sign-in.** People sign in with email and password, a magic link or GitHub, and can add authenticator two-factor. Password resets and magic links go out by email over SMTP. Settings → Security lists signed-in sessions and can sign any of them out.

> Needs setup: mail settings for magic links and resets, GitHub OAuth credentials for GitHub sign-in, and a sign-in secret.

**Workspaces.** One deployment hosts many workspaces, and a person can belong to several. A new workspace takes a name, a permanent address and a task prefix. Changing the prefix later renumbers every task reference, so Berry asks first.

**Roles.** Owner, Admin, Member and Viewer, checked on every change. The last owner can't be removed.

**Invitations, join links and personal access tokens.** Each secret is shown once and stored only as a hash, and each can be revoked.

**Preferences.** Time zone, sidebar layout, reduced motion and notifications. English is the only interface language.

---

## 7. Connect, plugins and the public API

**Connect.** The Connect area holds the plugin catalog. Plugins install from the bundled catalog, from a link or from a package file. Berry shows everything a plugin asks for before an admin approves it: permissions, events, schedules, pages and agent tools.

Hosted MCP plugins proxy a service's MCP server. Services that support MCP OAuth connect in one click, with Berry registering a PKCE client when the host allows it. Agent tools stay off until an admin switches each one on. A task assigned to an agent can name the plugins its run may use.

> Needs setup: the server's encryption key.

**Public API and SDK.** `/v1` takes personal access tokens or short-lived plugin tokens. It reads and edits tasks and comments, and lets a plugin read its own settings through `/v1/self`, all under the product's permission checks. The Node.js plugin SDK wraps it, verifies signed event and schedule calls, and helps build plugin pages.

---

## 8. How it runs, and why you can trust it

**A control plane, not a model client.** The server imports no model SDK, and a repository check enforces it. A run is a task envelope sent to an AgentCore Runtime or to the same image over HTTP. Subscription CLIs run on the workstation, beside the server or through the VS Code companion bridge. Their own shell and file tools stay off, and Berry's tools are served to them over MCP. Every envelope carries the conversation so far, rebuilt from Berry's records, so a cold session can resume.

**One narrow door.** An agent never touches the database. It calls named tools through `/api/v1/agent-tools` with a run token. The token lasts at most eight hours, is checked on every call, and dies with the run. The workspace and task come from the token, never from the model.

**People release the work.**
- No autonomy level includes a merge tool.
- The status tool can't choose *done* or *cancelled*.
- Work merges only when a person presses Accept, or a plan's AutoGate consent is met by passing blocking reviews.

**Secrets are sealed.** Plugin secrets, agent environment variables, MCP headers, runtime tokens and source-control tokens are sealed with AES-256-GCM under the operator's key. Without that key, the features that need it are off.

**Durable, live records.** Every change writes an outbox event in the same transaction. Board and workspace streams replay from it, with updates arriving in about half a second.

**Self-hosted.** A Node.js server and a Next.js web app run against PostgreSQL, or embedded PGlite locally. Other ways to run it:
- Docker, through one root `compose.yaml`
- ECS Fargate, through CloudFormation
- an Electron desktop app

Several servers can run side by side: database locks stop two taking the same run or Loop slot. Liveness, readiness and Prometheus endpoints support monitoring.

---

## What's next

- Delivering notifications outside Berry. Connected accounts are recorded but not yet verified or used.
- More interface languages.
- Enforcing the Loop turn limit on subscription CLI runtimes.
- Connecting Bitbucket.
- A faster live-update relay; the code exists but isn't switched on.
