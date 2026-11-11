## Who this guide is for
This guide is for people who use Berry day to day: they write tasks, hand some of them to agents, and decide what ships. It walks through a first task from start to finish, then covers the routines that keep a workspace healthy. Each section links to the reference page that has the full detail.

Some steps need your installation to be set up first. When a step says *Needs setup*, ask whoever runs Berry, or read [Deployment and maintenance](operations.html).

## Your first day
1. **Sign in.** Use email and password, a magic link, or GitHub, whichever your installation offers. You can turn on two-factor sign-in under Settings → Security & access.
2. **Pick a workspace.** Open the workspace menu to switch between workspaces, accept an invitation, or create one. A new workspace asks for a name, a permanent address and a task prefix such as `BER`. The address cannot be changed later.
3. **Check what your installation can do.** The sidebar's Help menu shows the server version. Features your installation does not have stay switched off in the app instead of failing when you use them.
4. **Find your way around.** The sidebar holds Inbox, My tasks, Agent (chat), Reviews and your pins. Open the command palette to search tasks by title or key (for example `BER-4`), projects, people, agents and pages, or to run a command.

## Set up a workspace (owners and admins)
Do these once, in this order. Members can skip to the next section.

1. **Connect a model.** Settings → AI providers. Connect a subscription CLI that is already signed in on the workstation, an API token, or an LM Studio server. Without one, agents cannot run. *Needs setup:* an agent runtime on the server.
2. **Place models on tiers.** Settings → Model tiers. Each agent runs on a tier (Max, XHigh, High, Mid or Low) and uses the first connected model placed there.
3. **Add agents.** Every workspace starts with only the Orchestrator, which routes work and cannot be edited. Add roles from the Agent catalog or Settings → Organization, for example a Software Engineer and a Reviewer.
4. **Connect source control.** Settings → Source control, to install the GitHub App or paste a GitLab token. Then add the repositories you work in under Settings → Repositories, and link each project to one. *Needs setup:* the server's encryption key.
5. **Write the house rules.** Settings → General → Agent context is given to every agent in the workspace. Put conventions and things an agent must never do here.
6. **Invite people.** Settings → Members, or create a join link. Give each person the lowest role they need: Owner, Admin, Member or Viewer.

## Run your first task with an agent
1. **Write the task.** Press *New task* in the sidebar. Give it a title and a description that says what is wrong or wanted, what "done" looks like, and how to check it. *AI improve* can rewrite a draft for you. The description is saved exactly as you type it.
2. **Pick a project.** A project links the task to a repository, which an agent needs before it can change code.
3. **Assign it.** The assignee picker lists people and agents together. Choose an agent and press *Assign and start*. Assigning an agent to a task already in Todo also starts it.
4. **Watch the run.** The task shows the run's status and its ordered event log, live. You can cancel a run at any time. Only one run can be active on a task.
5. **Talk to the agent if needed.** Comment on the task and **@**-mention the agent to start another run with your comment as context. Switch the comment to *note* mode to write without waking anyone.
6. **Review the result.** When the agent finishes, the task moves to *In review* and appears in Reviews. The agent's final message is posted as a comment, and a run that changed files shows its branch, diff and pull request.
7. **Decide.** In Reviews, *Accept* merges the pull request and marks the task done. *Decline* needs a note: the task goes back to Todo, and the agent reads your note on its next run.

An agent can move a task only as far as *In review* or *Blocked*. It cannot mark work done or merge it. That decision is always yours, unless you consented in advance with AutoGate (see below).

## Daily routines
**Start with the Inbox.** It collects mentions, assignments, reviews waiting for you, and runs that finished or failed. Archive an item once you have dealt with it.

**Clear Reviews.** Each review shows the pull request, the diff, the agent's summary, the checks it ran and any reviewer verdicts on one screen. If the branch conflicts with its base when you accept, the task goes back to its agent to resolve the conflict.

**Answer Approvals.** Approvals hold yes-or-no decisions that must come first: starting a flagged task, accepting a proposal, or answering an agent's escalation. A task waiting on an escalation stays blocked until someone answers. Only the person or role it is addressed to, or someone more senior, can decide.

**Check Proposals.** Agents file work they discovered, with evidence and severity. Most proposals wait on the Proposals page for a person to accept or reject them.

**Watch failed runs.** The Agents page shows each agent's runs and failures over the last seven days. Settings → Usage shows what is running now, spend by agent and model, and the failure rate.

## Plan larger work
For more than a handful of tasks, describe the outcome in a sentence and let Berry draft a plan: milestones, tasks with dependencies, and the tasks that need your approval before an agent starts. Nothing reaches the board until you start the plan. After it starts, the Orchestrator assigns each task to the best-fitting agent. A task it cannot place stays unassigned.

Use *Blocked by* to say what must finish first. When every task a task waits on is finished, Berry moves it to Todo and starts its agent.

**AutoGate** lets you consent in advance. It is off by default, and then every finished task waits for you in Reviews. When you turn it on, a task is released once every blocking review its author's role requires has approved it: Berry merges the pull request and closes the task. A rejection sends the task back to its author a limited number of times, then leaves it for a person. An inconclusive review never counts as approval. Turn AutoGate on only for work whose reviews you trust.

Read [Planning and automation](planning.html) for the full rules.

## Automate recurring work with Loops
A Loop is a standing instruction for one agent: triage new bugs daily, write release notes when a pull request merges, and so on. Create one from Loops by describing it in a sentence or starting from a template. Nothing is created until you review it and press Create.

Loops start in *Ask before acting* mode, which keeps the agent to reading, commenting and proposing. Their output waits in Reviews like any other agent work. Use *Run now* to test a Loop before you rely on its schedule. Read [Loops](loops.html) for triggers and limits.

## Organize and find work
- **Views.** List, Board, Table, Swimlanes and Gantt show the same tasks. Filter and group from *Display*, then save the combination as a private or shared view and pin it.
- **Cycles.** Timeboxes with a burn-up chart. A task belongs to at most one cycle.
- **Projects and milestones.** A project has a lead, dates, health and a repository. Milestone progress is the share of its tasks that are done.
- **Labels and task fields.** Labels are workspace-wide and also steer reviews; the *security* label brings in a security reviewer. Custom task fields are managed under Settings → Task fields.
- **Keyboard shortcuts.** Settings → Keyboard shortcuts lists every shortcut and lets you change them. Changes are kept in your browser.

Read [Work tracking](work-tracking.html) for every field and view.

## Look after your agents
- **Edit an agent** from its page: General, Instructions, Role and Permissions, Skills, MCP servers and Usage. Edits are a draft until you save and apply from the agent's next run.
- **Keep instructions short and specific.** Put shared rules in the workspace's Agent context, not in every agent.
- **Archive, don't delete.** Archiving an agent keeps its history. There is no hard delete.
- **Check autonomy before you rely on a role.** A role's autonomy level (1 to 5) limits which tools it can call. Level 3 is the first that can run commands and open pull requests.

Read [Agents and chat](agents.html) and [The agent organization](organization.html) for detail.

## Keep your account and workspace safe
- Review signed-in sessions under Settings → Security & access and sign out any you do not recognize.
- Create API tokens under Settings → API tokens only for scripts that need them. A token is shown once; revoke it when you no longer need it.
- Revoke join links when an onboarding window closes.
- Remove members who have left. Berry will not remove the last owner.
- Changing the task prefix renumbers every task reference. Berry asks before it does so.

## When something looks wrong
| What you see | What to check |
| --- | --- |
| A task stays queued | Is a model connected on the agent's tier? Is another run already active on the task? See [Troubleshooting](troubleshooting.html). |
| An agent's run failed | Read the run's event log and the final comment, fix the description or the setup, then start it again. A new run is a new attempt: check what the last one already changed first. |
| A task is blocked | Look for an unanswered approval or escalation, or an unfinished *Blocked by* task. |
| A review never arrives | The agent may have ended without changes, so no pull request was opened. Read its final comment. |
| A feature is missing from the app | Your installation may not have it set up. Ask your administrator. |

## Sources
This guide summarizes `PRODUCT.md` and the interface labels in `frontend/messages/en/`. Where `PRODUCT.md` says "AI runtimes", the settings page is labeled *AI providers*.
