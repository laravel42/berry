# Berry

**One task tracker for people and AI agents, where a person always makes the final call.**

Berry is a self-hosted workspace where a team and its AI agents share one task tracker. A task goes to a person or to an agent. When an agent gets it, the agent does the work: it reads the task, writes code, runs checks and opens a pull request. Then a person looks at the result and decides whether the work is done. Assigning, discussing, reviewing and closing work look the same whether a human or an agent did it.

Berry is built on one idea: **agents should work for people, not around them.** Agents can plan, build, review each other and suggest new work. They can't release their own work. No agent can mark a task done or cancelled, and no agent role has a tool that merges code. Each agent in Berry's built-in organization has an **autonomy level** that caps which tools it can use. Agents you add outside the organization have no level; the permissions you give them govern what they can do in a repository. Risky steps wait in an approvals queue for a person to decide. Delivered work waits in a review queue until a person approves it.

Your team runs Berry on its own infrastructure. The agents run in a separate, isolated runtime on AWS, and the Berry server never talks to an AI model directly. Every action an agent takes is a named, checked call through Berry, made with a key tied to the task it was given. Beyond that task, an agent can only add to the same workspace, such as new tasks, sub-tasks, projects, proposals or a request for a person's decision, and only when its tools allow it.

---

## A few words used throughout

- **Task.** A unit of work: a title, a description, a status and an assignee. The code calls these "issues". The product calls them tasks.
- **Agent.** An AI worker in the workspace. It has a name, instructions, a model, skills and permissions. You can assign it tasks, mention it and chat with it, just like a teammate.
- **Run.** One attempt by an agent to work on a task. A run is queued, starts, reports progress, and then finishes, fails or is cancelled. Every step is recorded.
- **Runtime.** The separate, isolated place where agent runs happen. Berry hands the runtime a task and records what comes back. Berry's standard runtime is Amazon Bedrock AgentCore Runtime.
- **Autonomy level.** A number from 1 to 5, given to each agent in the built-in organization, that caps which tools it may use. Level 1 can only read, comment and escalate. Level 5 can also submit a review verdict. Whether that verdict can send work back or only advises depends on the role contract of the agent whose work is reviewed. No level can merge code or close a task.
- **Review gate.** The point where delivered work stops and waits for a person to approve it or send it back.
- **Approval.** A yes-or-no decision a person must make before something goes ahead, such as starting a risky task.
- **Pull request.** A proposed code change on GitHub, which a person can read and merge.

## How to read the status notes

Most of Berry works as soon as it's installed. Some features need outside services first, such as an AI runtime, a file store or a GitHub connection. Those features carry a short **Needs setup** note that says what's required. Berry tries to report its own abilities honestly: when something isn't configured, the product says so rather than pretending.
---

## A day with Berry

Maya leads a small product team. This morning she wants a CSV export on the invoices page.

**8:55. She describes the goal.** Maya opens Berry, chooses *Plan something…* from the command menu, picks the Invoices project in the plan dialog, types "Let customers export their invoices as CSV" and presses *Plan it*. She turns AutoGate on, so agents review the work before she does. That doesn't take her out of the loop: an agent's approval never moves a task to Done. Only a person does.

**8:57. Berry asks instead of guessing.** Before it creates anything, Berry shows her a plan page. The plan has no tasks yet because it contains one blocking question: *"Should the export include all invoices, or only the ones matching the current filter?"* The question comes with concrete options. Maya picks "only the filtered view", and Berry re-plans with her answer treated as a settled fact.

**9:00. The plan starts.** The new plan has two milestones: *Export endpoint*, then *Export button and download*. Each milestone has a few tasks, with dependencies between them. Berry has checked that nothing depends on a task that doesn't exist and that there are no loops, and it marks the plan as low risk. Because the new plan passes its checks, submitting her answer counts as pressing *Start Plan*. Each milestone becomes a goal, and each planned task becomes a real task on the board.

**9:01. Berry routes the work.** The workspace Orchestrator reads the new tasks and the list of available agents. It assigns the endpoint work to the Backend Engineer agent and the button to the Frontend Engineer agent. Tasks that aren't waiting on anything start right away.

**9:05. The agents get to work.** On the board, Maya sees each run's status update live as the agents work. Partway through, the Backend Engineer isn't sure about a date column, so it hands a small sub-task to the Database Engineer agent. That sub-task appears on the board, linked to its parent.

**9:40. The work is delivered.** The run finishes. The runtime pushes the branch, and Berry opens a pull request titled with the task key. The pull request description holds the agent's summary and a report of which project checks ran and whether they passed. The task moves to *In review*. The agent's final message also appears as a comment on the task, so Maya doesn't have to go looking for it.

**9:45. Peer agents review first.** The Backend Engineer's role contract requires a QA review, so the QA Engineer agent reads the diff and the checks and approves. The approval doesn't close the task. It stays in review, waiting for a person.

**10:15. Maya decides.** Maya opens *Reviews*. The pull request, the agent's summary, the checks, the QA verdict and the diff all sit on one screen. The frontend change looks right, so she clicks *Approve* and the task moves to *Done*. On the endpoint she notices the currency is missing. She clicks *Send back* with the note "include the currency column", and the task returns to *Todo*. The agent reads her note on its next run and delivers again, and this time she approves.

**Friday.** The Security Engineer agent runs its weekly discovery and files a proposal: a route is missing an authorization check, and here is the file that shows it. Because the proposal has security impact, Berry doesn't act on it alone. The proposal waits in *Proposals* until an admin accepts it.

Maya never copied agent output into a pull request by hand, and nothing was released without her say-so.

*This story assumes the deployment has an agent runtime and model access set up, and that a workspace member has signed in with a GitHub account that can reach the repository. Without the runtime and model access, tasks, reviews and approvals still work, but Berry can't draft plans, route tasks or run agents.*

---

## 1. Work tracking

Berry is a complete task tracker in its own right. Everything below works the same whether a task belongs to a person or an agent.

### Tasks

A task is Berry's basic unit of work. It has a title, a description, a status, a priority, an assignee, a project, a due date, labels and any custom fields the workspace has defined. You can create one from the Tasks page with *Create task*, by typing a title into the add row at the bottom of the table view, or from the command palette. The create dialog has two modes. *Write it* is for filling in the task yourself. *Hand it to an agent* lets you type what you want and pick the agent to do it. Either way, a task is the one shared record that people and agents work from.

### Statuses and priorities

Tasks move through backlog, todo, in progress, in review, done, blocked and cancelled. Priority is none, urgent, high, medium or low. You can change either one inline from any list, from the board columns or from the task's properties panel, or change many tasks at once. Status changes follow set paths: for example, a task can only be marked *Done* from *In review*, so finished work always passes through that status first. Statuses carry meaning for agents as well: an agent can move a task as far as *In review* or *Blocked*, but only a person can move it to *Done* or *Cancelled*.

### Assigning to a person or an agent

The assignee picker lists workspace members and the workspace's agents side by side, with a filter for finding an agent by name. When you create a task for an agent, or assign several tasks to an agent at once, Berry asks whether to *Assign and start*, which begins a run right away, or *Assign without starting*, which leaves the task in the backlog. If you assign an existing task that's already in Todo to an agent, the agent starts on it automatically. When you assign several tasks at once, the agents you assign most often are listed first. This is where "agents as teammates" becomes concrete: handing work to an agent looks exactly like handing it to a colleague.

> **Needs setup:** starting a run needs an agent runtime connected to the deployment. Without one, you can still assign tasks to agents, but the runs wait until a runtime is available.

### Sub-tasks and parent tasks

A task can have sub-tasks, and the parent shows a done-out-of-total progress count. You can create a sub-task from scratch, turn a comment into one, or attach an existing task. Sub-tasks can also be grouped into numbered *stages*, where a later stage is held back until the earlier ones finish. From a task's menu you can set, change or remove its parent. This lets big work break down cleanly, and agents use the same mechanism when they hand pieces of work to each other.

### Dependencies

A task can declare that it's blocked by another task in the same workspace. Berry checks the dependency graph and refuses a link that would create a loop. You add and remove dependencies in the Relations section of the task page. When a plan starts, a task whose prerequisites aren't finished is created as *Blocked*, so agents don't pick it up. When every task it waits on is done or cancelled, Berry moves it to *Todo* by itself and, if an agent is assigned, starts that agent's run. A task that is blocked on an open escalation stays blocked until a person answers. Outside plans, a dependency is a visible record and doesn't by itself stop an agent from starting.

### Labels

Labels are workspace-wide tags you can put on tasks. Admins manage the label list, with a name and colour for each, under Settings → Task labels. Removing a label keeps it on tasks that already have it but stops offering it for new ones. Labels also steer reviews: for example, when a code-writing agent from Berry's built-in agent roster works on a task with the *security* label, the Security Engineer agent is brought in as a required reviewer.

### Custom fields

A workspace can define its own task fields: text, number, yes/no, date, link, and single or multi-select, up to a per-workspace limit. You set and clear them from a task's properties panel with *Add property*. Admins manage fields under Settings → Task fields. A field's type is locked once it's created, because existing values were already checked against that type. Archiving a field keeps its values, makes them read-only and stops offering the field on new tasks. An archived field can be restored.

### Due dates

You can give a task a due date with a picker or a quick option such as today, tomorrow or next week, and clear it again later. In the Gantt view you can drag the end of a task's bar to change its due date.

### Descriptions and attachments

Each task has a plain-text description, saved exactly as typed. You can attach files such as screenshots or documents by dragging them in or using *Attach a file*. Images open in a built-in viewer. Attachments have a configurable size limit, 25 MB by default.

> **Needs setup:** attachments need a file store (Amazon S3 or any S3-compatible service). Without one, uploads are turned off. Descriptions work without any setup.

### Comments, mentions and replies

Every task has a threaded conversation. You can reply, edit, delete (which also removes the replies) and resolve or reopen a thread. Typing **@** mentions a person or an agent, and mentioning an agent can start a run for it on that task. A *note* mode lets you comment without waking any agent, and **/** opens slash-command shortcuts. Talking to an agent works the same way as talking to a colleague: you mention it where the work is.

### Reactions

You can add and remove emoji reactions on tasks and on individual comments.

### Following a task

You can follow a task, optionally including all of its sub-tasks, to get notified about its activity, and stop following at any time. The followers list on the task page shows who's watching, and you can edit it.

### Activity history

Each task keeps a complete, time-ordered history of what happened to it: status, field, label and assignee changes, comments, reactions and changes to its parent or sub-tasks. Every entry names who did it, person or agent. The history is on the task page below the description, so anyone can see exactly how the work got to where it is.

### Doing the same thing to many tasks

In the list and table views you can tick several tasks and use the selection toolbar. From there you can change their status, priority or assignee, delete them, or assign them to an agent and start runs, all in one step.

### Boards

Tasks live on boards. A board's columns map to statuses, with Backlog, Todo, In progress, In review and Done by default. Each board has its own live update stream, so everyone looking at it sees changes as they happen.

### Five ways to view work

The *Layout* switcher at the top of the Tasks page shows the same tasks in five ways:

- **List:** a simple linear list.
- **Board:** kanban lanes you can drag tasks between.
- **Table:** a spreadsheet where you choose the columns, search by title or task key, export to CSV, and show totals such as count, sum and average.
- **Swimlanes:** grouped lanes.
- **Gantt:** a timeline from each task's creation to its due date, which you can zoom to days, weeks or months. Drag the end of a bar to change the due date.

Each layout remembers its own display settings.

### Grouping, sorting and card fields

The *Display* menu, available in every view, groups tasks by status, priority, assignee, project or parent. It sorts by created date, updated date, due date or title, or by your own drag order. It also toggles whether sub-tasks appear inline and chooses which fields show on each card. One click resets everything.

### Filters

The filter bar narrows tasks by scope (all, assigned to me, created by me, members, my agents), status, priority, assignee, creator, project, label, created or updated date (today, last 3 days, last 7 days or a custom range) and any custom field. Berry shows how many tasks the active filters are hiding, and one click clears them all.

### Saved views

You can save any combination of filters, grouping and layout as a named view. A view can be private or shared with the whole workspace, pinned to the sidebar, reordered, hidden without deleting it, or edited later. If someone else changed a shared view since you opened it, Berry notices before you overwrite their changes.

### Search and the command palette

A keyboard shortcut opens the command palette from anywhere. As you type, it searches tasks (by title or by a task key such as BER-4), projects, people, agents, chats and skills. It also runs commands: new task, new project, copy link or ID, fold or unfold comments, and open in a new tab. Press Enter to open a result, or use the key combination shown next to it to open it in a new tab.

### Pins

You can pin tasks, saved views and projects to your own sidebar and drag them into any order. Pins are personal, so each person's sidebar reflects the work they care about.

### My tasks

*My tasks* in the sidebar's Personal section goes straight to the tasks assigned to you.

### Inbox

The Inbox is your personal notification feed for work you follow. It covers comments, mentions, assignments and unassignments, status changes, review requests, reactions, runs that finished or failed, agents that got blocked, paused autopilots and more. You can mark items read or unread, archive or unarchive them one at a time or in bulk, and filter by status, priority or sender. A badge shows your unread count. The Inbox has a full page, plus a lighter drawer you can open from anywhere. This is how a person keeps up with what their agents are doing without watching every run.

### Keyboard shortcuts

Berry has a full set of shortcuts: creating a task, toggling sidebars, finding text within a task, archiving an inbox item, and jumping to My tasks, Inbox, Chat, Projects, Goals, Reviews, Views, Agents, Runtimes or Settings. Under Settings → Keyboard shortcuts you can search the list, record a new key combination for any action, turn a shortcut off, or restore the defaults. Your changes are saved in the browser you make them in. Berry warns you about conflicts and about combinations the browser reserves. A few shortcuts are fixed and can't be changed: opening the command palette, closing an overlay and moving between tabs.

---

## 2. Planning and automation

This part of Berry turns one sentence into organised work and keeps recurring work going without anyone having to remember it.

### The AI planner ("Plan it")

You describe what you want in one sentence, and Berry drafts a full proposal before creating anything. The proposal has:

- a few milestones in delivery order
- tasks under each milestone, with dependencies between them
- the capability (label) each task needs
- which tasks need a person's explicit approval before an agent may start them, because they commit to something real such as deleting data, spending money or touching something outside the repository
- a blocking question with concrete answers, when the request is genuinely ambiguous

To use it, open the command palette, type "plan" and choose *Plan something…*. A plan page also has a *New plan* button. Type your goal, optionally pick a project, and press *Plan it*. You can also create a project with *AI workflow* as its lead, which plans the project as soon as it's created. You land on a plan page that shows the milestones, tasks, dependencies, and any warnings or risk.

**Nothing appears on a board until the plan is started.** Usually a person does that by pressing *Start Plan*. Two actions also start it. Submitting your answers to the planner's questions starts the plan straight away, as long as the new plan passes its checks. Creating a project with *AI workflow* as its lead opens the plan page, and that page starts the plan once it's ready, as long as it stays open. Each of these is a person's action: the agent proposes, and a person decides.

> **Needs setup:** the planner needs an agent runtime and model access. Without them, pressing *Plan it* tells you the planner isn't available on this deployment.

### Clarifying questions

When the planner can't decide something with confidence, such as "real-time or nightly batch?", it asks. It doesn't guess. A blocking question offers two to four clear, mutually exclusive options, plus room for your own answer, and the plan proposes no tasks until the question is answered. Assumptions that aren't blocking are shown as well, so you can quietly accept them or correct them. A step-by-step wizard titled "Berry needs an answer" asks the blocking questions first; the others can be skipped. When you finish, the planner runs again with your answers treated as settled facts, and it's told not to ask again about anything you've answered. If the new plan passes its checks, Berry starts it straight away: submitting your answers counts as pressing *Start Plan*.

> **Needs setup:** this uses the same runtime and model access as the planner.

### Plan checks and risk

Every plan is checked by ordinary code, with no AI involved:

- task IDs are unique
- every dependency points at a real task, and no dependencies form a loop
- every approval actually gates a task
- every task belongs to a milestone, and every milestone has at least one task

The plan also gets a low, medium or high risk rating. It's high if any task needs approval or there are more than 12 tasks. Berry warns you when the target project has no linked repository for an agent to work in. The results appear on the plan page before you can start it.

### Automatic routing (triage)

The planner describes what each task needs, not who should do it. After a plan starts, the workspace's Orchestrator agent reads the list of available agents (their descriptions, roles and capabilities) and the new tasks. It assigns each task to the agent that fits best, and it can tag a task with a named workflow, a chain of roles the work should pass through. Berry only accepts assignments to agents and tasks that actually exist. Tasks it can't place stay unassigned rather than being assigned to someone made up. Tasks that aren't waiting on a dependency start right away. Tasks the plan marked as needing approval wait in the backlog with an approval request, and routing doesn't start them: an agent starts only after a person approves. None of this needs a button: it happens after *Start Plan*, or after you answer a blocking question. If routing can't happen, the tasks stay on the board for you to assign by hand.

> **Needs setup:** routing needs an agent runtime, model access and at least one available agent in the workspace.

### Goals

A goal is the group of tasks that one plan milestone produced. It's how Berry tracks milestones as real records. A goal moves through draft, planned, active (or blocked), then completed or cancelled. It shows live progress: how many of its tasks are done or cancelled, and how many approvals are still pending. Goals are created automatically when you plan work in a project, one per milestone, so you never make one by hand. The Goals page and each goal's own page show its tasks, pending approvals and related plans.

### Projects

A project groups related tasks under one status, health rating and target date. It can be linked to a GitHub repository so the agents working on its tasks have code to work in. A project holds the goals its plans produced, and you can look at it as an overview, a task list or an activity feed. You create one from the Projects page. Give it a name and a lead; status, priority, start and target dates, a summary, a description and a repository are optional. With a person as lead, Berry just creates the project. With *AI workflow* as lead, Berry also plans the project and opens the plan page, which starts the plan once it's ready. After that you add tasks directly, or plan more work by picking the project in the plan dialog.

### AutoGate

AutoGate is a per-plan setting for who looks at finished work first. When it's off, which is the default, every finished task waits for a person. When it's on, a second agent that didn't do the work reviews each delivered pull request before a person sees it. If the work comes from an agent in Berry's built-in organization, the reviewers its role requires do that review instead (see [required reviews](#required-reviews)). When AutoGate is off, no agent reviews the work at all: it goes straight to a person. If that reviewer rejects the work, the task goes back to *Todo* with the reason and the author gets another run, up to a small limit (two attempts by default). After that, the task is left for a person no matter what. **If the reviewer approves, the task still stays in review for a person.** An agent's approval never closes a task. You turn AutoGate on with the *AutoGate* chip in the New Plan dialog. The setting is copied onto each task when the plan starts, so changing the plan later doesn't affect work that's already underway.

> **Needs setup:** the peer review is itself an agent run, so it needs an agent runtime. It also reviews only work delivered as a pull request, so the project needs a linked GitHub repository. Without these, AutoGate has no effect and tasks wait for a person.

### Autopilots

An autopilot is a standing instruction given to one agent that fires again and again: on a schedule, when a webhook arrives, or when you click *Run now*. Each firing becomes an ordinary agent task you can watch like any other. An autopilot either opens a new task each time (for example, a daily standup summary) or keeps working one standing task (for example, watching a single dashboard). You can cap how often it runs (N runs per hour, day or week), and you can pause, resume or archive it without losing its history.

To create one, click *New autopilot* on the Autopilots page. While the workspace has no autopilots, the Autopilots page offers templates to start from (daily standup, inbox triage, stale-task sweep, weekly digest, release notes or failure watch); otherwise you start from scratch. Choose the agent, write the runbook (the instructions it follows, which can include placeholders such as the time it fired or fields from the incoming webhook), choose "opens a task" or "works one standing task", and add a trigger. A schedule trigger uses a friendly time picker or a raw cron expression. Each autopilot has Overview, Triggers, Runs and Deliveries tabs, and you can add collaborators and subscribers. With several Berry servers running, each scheduled slot still fires only once.

> **Needs setup:** each firing starts a real agent run, so autopilots need an agent runtime. Without one, the scheduler doesn't start at all.

### Webhook triggers for autopilots

An outside system, such as CI, monitoring or another online service, can start an autopilot by posting to a unique, secret Berry address. Each request must be signed with a signing secret that Berry shows exactly once. You can also list event names so the autopilot ignores everything else. Berry logs every delivery with its full payload and outcome: accepted, filtered out, or rejected for a bad signature, a malformed body or a disabled trigger. You can replay a delivery later, except one that failed its signature check or was already refused. You add a webhook on an autopilot's Triggers tab, copy the address and secret right away, and check the Deliveries tab to see every attempt.

> **Needs setup:** webhook triggers need the server's encryption key, because Berry stores each trigger's signing secret encrypted. Without it, adding a webhook trigger is refused. The outside system must also be able to reach your Berry server.

### Quick actions

A quick action is a saved prompt the workspace defines once, such as "Summarise this task's discussion", and that members can run against a task in one click. A prompt can refer to the task's key, title and description. If it uses any other placeholder, Berry refuses to save it rather than send the agent a prompt with blanks in it. An action can be shared with the whole workspace or kept private, archived and later restored, or deleted permanently. Past runs keep the prompt they were given. The settings page shows usage counts, flags actions nobody has used in a while, and warns when an action uses an agent that not everyone is allowed to start. Any member except a viewer can define actions under Settings → Quick actions and run them from the task page. If the task already has a run going, Berry says so instead of starting a second one.

> **Needs setup:** running a quick action starts an agent run, so it needs an agent runtime. Without one, Berry says quick actions are unavailable.

### Named workflows

Berry ships six named chains of roles that describe the shortest sensible path for common kinds of work. The Orchestrator picks one when it routes a plan's tasks, so a task can be understood as passing through several specialist agents instead of being one agent's whole job. The workflow is saved on the task, and the review step later uses it to decide who should look at the work next. You don't use workflows directly. They're listed read-only on the Organization settings page, which the settings menu doesn't link to yet, and the full list is in [section 4](#named-workflows-between-roles).

> **Needs setup:** workflows take effect only through automatic routing, which needs a runtime and model access.

---

## 3. Agents

This part covers how agents are created, set up, talked to and watched, and how you see what they cost.

### The agent roster

The Agents page is a table of every agent in the workspace that you can filter and sort. For each agent it shows:

- whether the agent is online, busy or offline
- its current workload ("working", "queued N" or "idle")
- the health of the runtime it's bound to
- a seven-day chart of runs against failures
- its model, its owner, who can use it, its total runs and when it was last active

You can choose which columns to show, filter by availability, runtime, access, owner or model, and sort by recent activity, name, number of runs or creation date. You can also select several agents to archive or restore them in one go, or to open them to the whole workspace or limit them to admins. It's a fleet view of your digital colleagues.

### Creating an agent yourself

*New agent → Set it up yourself* opens a form: name, description, instructions, model (or the workspace default), starting skills and access. Berry saves an unfinished form in your browser, so you can pick it up again if you get interrupted.

### Describing an agent and letting Berry draft it

*New agent → Describe it* opens a conversation. You describe the agent you want, and Berry drafts a name, description and instructions. You refine the draft turn by turn, edit it by hand, and press *Create this agent*. You can come back to a builder session later.

> **Needs setup:** drafting runs through the agent runtime and needs model access. Without them, your first message to the builder fails with a note that it needs the agent runtime, and Berry sends you back to set the agent up yourself.

### Agent profile: Overview

An agent's profile opens on an overview. It shows the owner, who can use it, the runtime it's bound to, its model, its concurrency setting and its skills. It also shows 30-day stats (runs, successes, average duration, failures), what it's working on right now, and its recently finished work.

### Agent capabilities

The Capabilities tab controls what an agent knows and which tools it can reach:

- **Instructions:** the guidance it follows on every task.
- **Conversation starters:** up to three, shown at the top of a new chat.
- **Skills:** chosen from a searchable picker.
- **MCP servers:** external tool servers. MCP (Model Context Protocol) is an open standard for giving AI agents extra tools. You can add servers for this agent alone with a short form (name, address, transport and any secret headers). Servers in the workspace library are listed alongside and are available to every agent automatically.

Changes take effect on the agent's next run.

### Agent settings

The Settings tab lets you rename the agent and edit its description. You can also pick which runtime its tasks run on, choose a model from the live catalogue, and record how many tasks it should run at once (up to 20). Berry shows this number on the profile but doesn't enforce it yet; the runtime's own limit is what caps parallel work. Admins control who may assign or mention the agent: only themselves, everyone in the workspace, or specific people. Workspace owners and admins can always use it.

### Environment variables for an agent

Admins can give an agent private settings, such as API keys, that are passed into its runs. Values are encrypted when saved and never shown again. An admin can deliberately reveal them to edit one without retyping the rest, and every reveal and every change is recorded with who did it and when.

> **Needs setup:** this needs the server's encryption key. Without it, Berry refuses to store these values rather than keep them unprotected.

### Duplicating, archiving and restoring agents

You can copy an agent's instructions and skills into a new agent. The copy doesn't include environment variables or MCP servers. Archiving an agent stops it taking work but keeps its history, so it can be restored. There is no permanent delete: removing an agent archives it. A separate action cancels every running and queued run for one agent at once. The workspace Orchestrator is protected: Berry refuses to archive it.

### The Guide

Every workspace has a Guide agent that new members can ask how Berry works. After someone creates or joins a workspace, the "Your workspace is ready" screen offers "Questions? Ask the Guide", which opens a chat with it.

### The Orchestrator and the built-in organization

Every workspace starts with a protected Orchestrator agent and 18 role agents, each with a defined job and limits. This is a whole topic of its own; see [section 4](#4-the-agent-organization).

### Chat with an agent

You can have a one-to-one conversation with any agent, either on the full Chat page, where you can pin up to five agents, or in a floating chat widget that's available anywhere. You can keep, rename, archive or delete past conversations. While the agent is replying you can queue more messages, move a queued one to run next, remove queued messages, or stop the reply. You can bring tasks or projects into the conversation with **@**. Berry also suggests follow-up questions. Every reply runs with the agent's own instructions.

> **Needs setup:** replies run through the agent runtime. Without one, Berry says the agent has no runtime and replies can't run.

### Mentioning an agent in a comment

Typing **@** and picking an agent in a task comment inserts a reference that still works if the agent is renamed later. Posting the comment queues a run for that agent on that task. Asking an agent for help is the same gesture as asking a person.

### Starting a run on a task

When you create a task for an agent, or assign several selected tasks to an agent at once, you can choose *Assign and start* so the agent begins right away. Assigning an existing Todo task to an agent also starts it automatically. Each past run in the task's execution log has *Run again*. Berry refuses to start a second run while one is already active on the same task. Through the API, you can also start a run with extra instructions for that run only.

> **Needs setup:** the run is always queued safely, but it only happens once the deployment has a runtime and model access.

### A run's event log and transcript

Each run keeps an ordered log of events: started, messages, usage, and finished or failed. The log is stored, so through the API a reader can come back later and pick up from the last event they saw rather than start over. A run's status on the board updates live. The app's transcript and run views are meant to show this log step by step, but today they don't display its events; the agent's final message, posted as a comment on the task, is where the result shows up.

### Cancelling a run

*Cancel* asks a running run to stop. Cancelling is a request, not an instant switch, so the run may still show as running for a moment. If the run had already finished, Berry says so honestly instead of pretending it stopped it.

### What a run delivered

When a run changes files, Berry shows the branch, the number of files changed, lines added and removed, and a link to the pull request. A person always merges it; Berry never merges code. When a run changed nothing, Berry says so plainly. Either way, the agent's final message is posted as a comment on the task, so the person who asked sees the result where they already look.

### The Runs page

The Runs page lists recent runs from the workspace's main board, up to the latest 200: the task, the agent, the state and when it happened. Click a run to open its details.

### Agent activity and workload

An agent's Activity tab shows what it's doing now, with a cancel button, and what it finished recently. Failures come with a plain-language reason: timed out, runtime unreachable, cancelled or unknown. The roster adds a status dot, a workload badge and a seven-day chart for every agent.

### Usage, cost and the dashboard

The Usage page shows the workspace's model spending over time, by day or by week: cost, tokens, cache use, number of runs and run time. It also breaks the numbers down by agent and by model. If a model has no published price, Berry flags that usage instead of inventing a cost. An Errors tab covers the failed-run rate and which agents fail most. A separate Dashboard shows runs per day, cost per day and live counts of tasks by status. You can filter the Usage page by date range and by project, and the Dashboard by date range.

> **Partly working:** the pages work, but the numbers come from real runs. They stay empty until agents have actually run, which needs a runtime.

### Runtimes

A runtime is where agent tasks run. Every workspace gets a *platform* runtime automatically, matching whatever runtime the deployment is set up with. An owner or admin can also register another AgentCore Runtime. For each runtime you can:

- run a live health check
- see a 30-day activity chart, its usage and which agents are bound to it
- make it the workspace default
- keep it private to yourself or share it with the workspace
- delete it

Deleting a runtime only removes Berry's record of it, never the actual AWS resource, and agents bound to it fall back to the default. Runtimes live under Settings → Runtimes, and each one has its own detail page.

> **Needs setup:** you can register runtimes without any AWS access, but a runtime only does something once it points at a real, deployed AgentCore Runtime. Until then its health shows "never reached" and agents bound to it can't run.

### Runtime profiles and binding agents

A runtime profile bundles a name, encrypted environment variables, a default model and an idle timeout (from one minute to eight hours). You add profiles on a runtime's detail page. On an agent's Settings tab you can bind the agent to a particular runtime instead of the workspace default.

### Skills

Skills are reusable, named packs of instructions and knowledge that extend what an agent knows. You can write one in the app, or import one from GitHub or a zip file through the API, and then assign it to as many agents as you like. An imported skill remembers where it came from. For a skill imported from GitHub, you can choose *Update from source* at any time to pull in the latest version. This replaces everything in the skill with what the source holds now, including any edits made in Berry, so Berry asks you to confirm first. You manage skills on the Skills page and assign them on an agent's Capabilities tab.

### MCP servers

You can register external tool servers so agents can use tools beyond Berry's own. A server connects over streamable HTTP or SSE, can carry custom headers, and can optionally be routed through an AWS AgentCore Gateway. A server can go in the shared workspace library or belong to a single agent. Saving a server's headers replaces all of its headers at once. The library is under Settings → MCP servers, and per-agent servers are on the agent's Capabilities tab.

> **Needs setup:** a server with custom sign-in headers needs the server's encryption key to store them safely. A public server with no headers works without it. Gateway-routed servers need an AgentCore Gateway set up; without one, they're skipped at run time with a warning.

### Model picker with prices

When you choose an agent's model, Berry lists the available Amazon Bedrock models grouped by provider, cheapest first, with each model's price per million input and output tokens. When creating an agent you can also leave it on the workspace default.

> **Needs setup:** the catalogue needs an AWS region for Bedrock.

### Writing help in editors

When you create a new project or a new skill, you can ask Berry to rewrite the text you've typed according to a short instruction. It returns the rewritten text only.

> **Needs setup:** this runs through the agent runtime. Without one, editor assistance is unavailable.

---

## 4. The agent organization

Most AI tools give you a pile of bots. Berry gives every workspace an **organization**: a set of agent roles, each with a written job description, clear limits, people and roles it answers to, and reviewers who check its work. It's set up automatically, and it's designed so that more capable agents come with more oversight, not less.

### Who's in it

Each new workspace gets 19 agents in 7 departments: a protected Orchestrator and 18 professional roles. Every role has a written mission, responsibilities, inputs and outputs, and a preferred Claude model tier on Amazon Bedrock. Each role also records suggested turn and token limits for a run, but runs don't enforce them yet.

| Department | Role | Autonomy level | Model tier |
|---|---|---|---|
| Operations | Orchestrator | 2 | Sonnet |
| Product | Product Lead | 5 | Sonnet |
| Product | Business Analyst | 2 | Haiku |
| Product | UX Researcher | 2 | Haiku |
| Product | Product Designer | 2 | Sonnet |
| Engineering | Software Architect | 5 | Opus |
| Engineering | Engineering Manager | 2 | Sonnet |
| Engineering | Backend Engineer | 4 | Sonnet |
| Engineering | Frontend Engineer | 4 | Sonnet |
| Engineering | Database Engineer | 3 | Sonnet |
| Engineering | Integration Engineer | 3 | Sonnet |
| Quality & Security | QA Engineer | 5 | Sonnet |
| Quality & Security | Security Engineer | 5 | Sonnet |
| Platform | DevOps Engineer | 3 | Sonnet |
| Platform | Site Reliability Engineer | 4 | Sonnet |
| Growth & Insight | Data & Analytics Engineer | 3 | Haiku |
| Growth & Insight | Technical Writer | 3 | Haiku |
| Growth & Insight | Growth Engineer | 3 | Haiku |
| Leadership | CTO | 5 | Opus |

Opus is the most capable tier, Sonnet sits in the middle and Haiku is the fastest and cheapest. Because a role comes with a tier, picking the right agent for a job also picks a sensible model. You can still override the model for any agent. The Orchestrator's job is only to sort incoming work and send it along the shortest suitable path. It never builds anything, never reviews, and never decides product or technical questions itself.

You don't have to configure any of this. You can see the roster by department on the Organization settings page (the settings menu doesn't link to it yet), or open any agent's Role tab to read its full contract.

### Autonomy levels

Each role has a fixed **autonomy level**, a hard limit on which tools it can ever use. An agent's usable tools are whatever its contract lists *and* its level allows. Adding a tool to a contract without raising the level changes nothing, and if a stored contract is ever invalid, the agent drops to Level 1 rather than getting full access.

| Level | Name | What it can do |
|---|---|---|
| 1 | Advisory | Read tasks, files and project resources; comment; escalate. |
| 2 | Contributor | Everything in Level 1, plus write and attach files, create tasks and projects, change a task's status, propose work, hand work to other roles and mention other agents. |
| 3 | Executor | Everything in Level 2, plus run commands and collect files, so it can change code and open pull requests. |
| 4 | Autonomous | The same tools as Level 3, but trusted more: only Level 4 and 5 roles can have proposed work accepted without a person deciding (and only routine, low-risk work). |
| 5 | Authority | Everything in Level 3, plus submit a review verdict. Whether it blocks or only advises is set by the reviewed agent's contract. |

Each agent's Role tab shows its level with the plain name. The Organization settings page shows only the level number. Berry checks the limit when the agent calls a tool, not just in the agent's instructions, so an agent that tries to go past its level is refused.

### No agent merges or closes work

This rule is built into the tools themselves, not just a policy agents are asked to follow. No autonomy level includes a tool that merges code. The status tool agents use only accepts *todo*, *in progress*, *in review* and *blocked*, never *done* or *cancelled*. Even a Level 5 reviewer is told that its approval never releases the work: a person approves the release. In practice, agent runs stop at *In review* or *Blocked*, and a person makes the final call.

One setting comes close to this rule, and it's worth naming. An admin can give a single agent outside the organization a permission called *Merge without approval*; Berry refuses it for the organization's role agents, because it's above every autonomy level. It's off by default, marked as dangerous in Settings → Agents, and the agent list flags any agent that has it. Nothing in an agent's own instructions can turn it on, only a workspace admin can. Today it changes only what the agent's pull request says: the note that a person must approve before it merges is left out. Berry still only opens the pull request and never merges it.

### Handing work to another role

Each role's contract lists which roles it may hand work to and which roles it takes work from, and Berry keeps the two lists consistent with each other. From Level 2 up, an agent can create a sub-task with acceptance criteria for an allowed role. Berry links the sub-task to the parent, assigns it to that role's agent and tries to start a run; if the run can't start, the sub-task stays assigned so someone can start it. An agent outside the organization, or one trying to hand work to a role that isn't on its list, is refused. People see these hand-offs as new sub-tasks on the board. For example, an engineer might hand a schema question to the Database Engineer, or the Engineering Manager might split a feature between the Backend and Frontend Engineers.

### Escalating to a lead or a person

Any role can stop and ask for a decision it doesn't own, marking it as a product, technical, security or operational decision. If it escalates to the CTO or the Product Lead, a new linked task goes to that role's agent. If it escalates to a human, a pending approval appears for a person, with the question, the options and the agent's recommendation. Security escalations are marked high risk and others medium. Either way, the original task moves to *Blocked* if the board's rules allow it. Each role's contract also lists escalation paths as guidance, but the escalate step itself can only reach the CTO, the Product Lead or a person. For instance, the Backend Engineer's contract says to take architecture questions to the Software Architect, but in practice it must escalate them to the CTO or a person. It can pass security-sensitive changes to the Security Engineer as a sub-task.

### Required reviews

Every role that writes code is automatically given reviewers:

- **QA Engineer:** a blocking reviewer on everything.
- **Security Engineer:** blocking when the *security* label is set or security-sensitive areas change, such as sign-in, integrations, secrets, container definitions or cloud permissions.
- **Software Architect:** blocking on the *architecture* label or on core structural areas such as database migrations and the server's HTTP and runtime layers.
- **Database Engineer** (database changes) and **Product Designer** (interface changes): advisory reviewers who comment but don't block.

On top of that, some reviewers depend on how a task came in. The Product Lead blocks any task routed into the full-delivery workflow, and any task from an accepted proposal with product impact. The Security Engineer blocks tasks from accepted proposals with security impact, the Software Architect those with architectural impact, and the CTO those whose architectural impact is critical. A task a person wrote carries no impact kinds, so these impact rules apply only to proposed work.

Only the Level 5 roles (Product Lead, Software Architect, QA Engineer, Security Engineer and CTO) can submit a review verdict, and only in their own areas. A reviewer can never approve its own run. A rejection must cite findings with evidence. The Security Engineer's findings must also state how the issue could be exploited, its impact and how to fix it. Each agent's Role tab shows "Reviewed by" (with blocking or advisory tags) and, for Level 5 roles, what it reviews. The verdicts themselves appear on the task and in the Reviews page.

> **Needs setup:** each required review is a model call made through the agent runtime, and it happens only when the delivered work includes a pull request. Without a runtime, no required reviews run and the task simply waits in review for a person.

### Work proposals

From Level 2 up, a role agent can file work it discovered on its own, such as a bug, a gap or a risk, as a structured proposal. A proposal includes:

- evidence: files, runs, dependencies, metrics, tasks or links
- an impact statement and a severity (critical, high, medium or low)
- the kinds of impact: product, security, architectural, financial, operational or routine
- a proposed action, an effort estimate and any dependencies
- the role that should own it and the reviewers it needs

If the same role files the same problem with the same evidence while its earlier proposal is still pending, its task is still open, or it was rejected in the last 90 days, Berry returns the earlier proposal instead of filing a new one. It allows at most five proposals per run. Whether a person has to decide follows clear rules. A proposal is **accepted automatically**, which means it goes to *Todo*, is assigned to the right role and starts, only when *all* of these are true: the proposer is Level 4 or 5, the severity is low or medium, and every kind of impact is routine. **Everything else waits for a person.** The task goes to the backlog with a pending approval.

### Weekly discovery

All 18 professional roles have a *discovery brief*: what to look for from their professional angle and where to find evidence. Each role gets a standing task and a weekly scheduled autopilot that looks over the workspace and files findings as proposals, at most five per run. Every finding must come with concrete evidence, and the role is told explicitly not to build anything during discovery. Roles fire on different days and hours so they don't pile up. Some examples:

- The **QA Engineer** looks for critical user flows without automated tests and for flaky or skipped tests.
- The **Security Engineer** looks for vulnerable or unpinned dependencies, secrets in code or logs, and missing authorization checks.
- The **Technical Writer** looks for outdated setup or API docs and behaviour nobody documented.
- The **Engineering Manager** looks for blocked or ownerless tasks and conflicting parallel work.

Discovery only runs when the workspace's *Work discovery* switch is on (it is by default) and there's something to look at: a connected repository or at least one real task. Otherwise the run is skipped with a stated reason.

> **Needs setup:** discovery runs are agent runs, so they need an agent runtime.

### The Organization settings page

This page, described as "The roles your agents fill, what each may do, and the work they look for on their own", isn't listed in the settings menu yet. It shows:

- a *Work discovery* switch that owners and admins can change (others see an admin-only note)
- every role grouped by department, with its autonomy level and whether its discovery is active or paused
- a *Reset* action for any role whose contract has become invalid (a role that was only edited is reset from its Role tab)
- a Workflows section listing each named workflow as its chain of roles

Clicking a healthy role opens that agent's Role tab.

### Resetting a role to Berry's version

*Reset* puts one role's contract back to Berry's current definition: mission, permissions, hand-offs, everything. It also repairs a contract that has become invalid. Berry marks a role *Customized* when its stored contract no longer matches what Berry last wrote. There's no contract editor in the app today; a contract can be changed only through the API. A contract someone changed is never silently overwritten when Berry's definitions change; resetting is the deliberate way back. Only owners and admins can reset. An edited role is reset from the agent's Role tab; a role whose contract has become invalid can also be reset from the Organization settings page.

### The Role tab

Every agent's page has a Role tab that explains its contract in plain language:

- its title, department, and autonomy level with the level's name
- its mission and responsibilities, and what it produces and works from
- which roles it hands work to and takes work from
- its escalation paths
- who reviews its work, and what it reviews itself
- its "never" rules
- its weekly discovery focus

An agent outside the organization shows a note saying so, with its permissions managed under Settings → Agents.

### The Proposals page

The Proposals page lists work proposals waiting for a decision. Each card shows the severity as a coloured badge, the linked task, the effort, the problem, the evidence, the impact, the proposed action, the owning role and the required reviewers. Owners and admins get *Accept* and *Reject* buttons; everyone else sees a note that only owners and admins can decide. Accepting assigns the task to the owning role's agent and moves it to *Todo*. Rejecting cancels the task. When the page is empty, it points to Autopilots, since discovery is what produces proposals.

### Named workflows between roles

Six built-in role chains describe the shortest path of ownership for common work:

- **New product feature:** Product Lead → Business Analyst → Product Designer → Software Architect → Engineering Manager → Backend Engineer → Frontend Engineer → QA Engineer.
- **Full delivery:** the same chain, followed by Security Engineer, DevOps Engineer, Site Reliability Engineer and Data & Analytics Engineer, and back to the Product Lead.
- **Frontend visual bug:** Frontend Engineer → QA Engineer.
- **Authentication system:** Product Lead → Software Architect → Security Engineer → Backend Engineer → Frontend Engineer → QA Engineer → DevOps Engineer.
- **Database performance problem:** Site Reliability Engineer → Database Engineer → Backend Engineer → QA Engineer.
- **Production incident:** Site Reliability Engineer → Backend Engineer → Security Engineer → Site Reliability Engineer. Security joins only if the incident is security-related.

They're shown read-only on the Organization settings page and can't be edited today.

---

## 5. Review, approvals and delivery

This is where Berry keeps its central promise: agents deliver, and people decide.

### The Reviews page (the human review gate)

Reviews lists every task waiting for a person's decision after an agent delivered. For each one, it puts everything needed to decide on one screen: the pull request, the agent's own summary, the project's checks, and any peer verdicts. The page has two tabs. *Waiting* holds tasks still to decide. *Decided* groups past decisions into *Approved* and *Sent back*. Clicking a row opens it in the page's right-hand pane with Overview and Diff tabs, plus a Verdicts tab when the task has AutoGate on. Switching tabs doesn't reload the page, so you can decide without leaving Berry.

### Approve or send back

This is the gate itself. *Approve* moves the task to *Done*. *Send back* returns it to *Todo* and requires a note, which the agent reads on its next run. On approve the note is optional, and either way it's posted as a comment on the task. The decision is the task's own status change, not a separate record, so the task history, goal progress and live board updates all see the same event. You decide from the Reviews page. The task page shows any AutoGate verdicts, but the decision buttons are on the Reviews page.

### Approvals

Approvals is a separate queue of yes-or-no decisions that must happen *before* something goes ahead. It handles three kinds:

- starting a task that a plan flagged as a real commitment
- a proposed piece of work
- an escalation

Each approval says who it's addressed to (a specific person or a role), carries a low, medium or high risk rating, and links back to the task, goal or plan it gates. Only the addressee, or someone with that role or a more senior one, can decide it. Anyone else sees "This approval is addressed to someone else" or "An admin has to decide this one". You open Approvals, switch between All, Pending and Resolved (or show only the ones you can decide), and click *Approve* or *Reject* with an optional note. Approving a task start moves the task from Backlog to Todo, or to Blocked if other tasks still block it; it doesn't start a run by itself. Accepting a proposed piece of work hands the task to the agent that holds the responsible role and starts a run. Answering an escalation releases the blocked task and starts a run if an agent is assigned to it. Rejecting a task start leaves the task where it was, and rejecting a proposal cancels the proposed task. The decision and any note are recorded either way.

### AutoGate verdicts

When a plan has AutoGate on, a peer agent's verdict shows on the task under *AutoGate review* (Reviewing, Approved or Changes requested, with the reason) and in the Reviews page's Verdicts tab. A rejection sends the work back to the author, and after the attempt limit the task is left for a person. An approval still leaves the final decision to a person. See [AutoGate](#autogate) for how it works.

> **Needs setup:** needs an agent runtime and model access, and applies only to work delivered as a pull request. Without them, there's no AutoGate and tasks simply wait for a person.

### Role-based required reviews

When a task has AutoGate on and its author belongs to the organization, the work is checked by every role its contract requires for what changed, each on its own model and within its own area. Without AutoGate, none of these reviews run and the task waits for a person. Advisory reviewers only comment. One blocking rejection sends the task back with every rejecting role's reasons. When all blocking reviewers approve, the task stays in review with the note "Required reviews passed — waiting for a person". Progress is posted as a comment on the task, for example "Required reviews not complete". Each reviewer's verdict shows on the task under *AutoGate review* and in the Reviews page's Verdicts tab. If no agent currently holds a required role, Berry reports that role as missing instead of skipping it quietly.

> **Needs setup:** same runtime requirement as AutoGate.

### Connecting GitHub

There is nothing extra to install. People sign in to Berry with GitHub, and that sign-in already grants access to their repositories, private ones included. A workspace uses its members' GitHub sign-ins to list repositories, link them to projects, and let agents clone, push branches and open pull requests. When you list or link repositories, Berry uses your own sign-in. For agent runs, it uses a member's sign-in, trying owners first, then admins, then other members.

Settings → Integrations → GitHub shows GitHub as connected as soon as any member's GitHub sign-in works, and lists which GitHub tools agents are allowed to use. It also has a master *Use GitHub in this workspace* switch and three feature switches: show linked pull requests on tasks, credit the requester as a commit co-author, and link pull requests to tasks automatically by task key.

> **Needs setup:** needs GitHub sign-in configured on the server, and at least one workspace member who has signed in with GitHub. The settings page and the repository picker also need the server's encryption key; without it, they say the deployment has no encryption key, though agent runs can still use members' sign-ins.

### The workspace's repositories

Settings → Repositories lists the repositories this workspace actually works in, which isn't the same as everything GitHub happens to give access to. Each entry has a short note about what it holds, saved as you type. You can add one by pasting a link, or open *Import from GitHub*: a searchable picker of every repository your GitHub sign-in can reach, grouped by account, that marks repositories you've already added or archived. Only admins can change the list.

> **Needs setup:** importing needs a GitHub sign-in that can reach the repositories, and the server's encryption key. Adding by link works without them, but agents can only clone and push if a workspace member's GitHub sign-in can push to that repository.

### Linking a repository to a project

A project can be linked to exactly one existing GitHub repository, chosen by name. Berry stores the repository's permanent ID along with its name, so the link keeps working if the repository is renamed. Berry never creates repositories; it only links ones that exist. The linked repository is where a task's pull requests are opened and what the Reviews page shows for the task.

> **Needs setup:** looking up a repository by name needs working GitHub access.

### Delivery: branch, commit and pull request

When an agent's run ends with a committed change, **the runtime's own delivery step pushes the branch, not the agent's model.** The push is a safe one that won't overwrite someone else's newer changes. Berry then opens the pull request with the workspace's GitHub access, titled with the task key and title. The description contains the agent's summary and a verification report: which checks ran, whether they passed, and whether the checks ran out of time. A run that changed nothing is recorded as such, and no empty pull request is opened. You don't have to do anything: the task moves to *In review*, and the pull request shows on the Reviews page. If the pull request can't be opened, the run is marked as failed instead.

> **Needs setup:** needs a workspace member whose GitHub sign-in can push to the project's repository. Without one, the run can't check out or push the code. If the agent isn't allowed to open pull requests, the branch is pushed and no pull request is opened. If opening the pull request fails, the run is marked as failed.

### Linked pull requests, checks and closing on merge

Berry listens to signed updates from GitHub about pull requests and checks and matches them to tasks. When GitHub reports on a pull request Berry opened for a run, that pull request is linked to its task. When automatic linking is on, a task key in a pull request's branch name, title or description links it too, and a phrase such as "Fixes KEY-12" marks the pull request as closing that task. When a person merges such a pull request on GitHub, Berry moves the task to *Done* through its normal status steps. It never skips a step and never reopens a cancelled task. Checks are summarised as passed, failed or pending for each pull request. The task sidebar lists every linked pull request with its state, whether it closes the task on merge, and its checks, with links to any that failed.

> **Needs setup:** Berry doesn't currently receive these updates for a workspace connected through GitHub sign-in, so there linked pull requests and checks don't show on tasks, and merging a pull request doesn't close its task. The panel is on by default and can be switched off per workspace.

---

## 6. Workspace and administration

### Sign in with GitHub

People sign in to Berry with GitHub, and nothing else. If GitHub returns a problem, such as an unverified email or a cancelled authorization, the sign-in page explains it in plain words rather than showing a raw error.

> **Needs setup:** needs GitHub sign-in credentials (a client ID and secret from GitHub's developer settings) and a sign-in secret configured on the server. Without them, the sign-in button is disabled and a note for administrators explains what's missing. For local development and testing only, Berry can sign a developer in automatically as an existing account, without GitHub.

### Creating and switching workspaces

Berry supports many workspaces, and a person can belong to several. The workspace menu in the sidebar lets you switch to any of yours, which takes you to that workspace's Tasks page. A dot marks other workspaces with unread inbox items. *Create a workspace* asks for a name, a permanent address, a task prefix (such as BER) and a description.

### Onboarding

The first time someone signs in without a workspace, Berry walks them through a short setup. A welcome screen comes first, then an optional "about you" step, then the workspace itself: its name, its address (which is permanent) and its task prefix. Last is an optional pick of the workspace's default AgentCore runtime. You can skip setup at any step. Once the workspace is ready, Berry offers a chat with the Guide, if the workspace has one. Workspaces created later from the workspace menu use a plain form instead.

### Members and roles

Settings → Members lists everyone with their role and when they joined. Owners and admins can change a member's role or remove them; the person's past tasks and comments stay. Admins can only manage people in the member and viewer roles, and can only switch them between those two roles: only an owner can make someone an owner or admin, or change or remove an existing owner or admin. The last owner can't be demoted or removed.

### What each role can do

Berry has four workspace roles, each with a written list of permissions:

- **Owner:** everything, including managing other owners.
- **Admin:** manages settings, invitations, plugins and the product, and manages people in the member and viewer roles, but can't make anyone an owner or admin, can't change or remove other admins or owners, and can't delete the workspace.
- **Member:** creates and edits tasks, comments and starts agent runs.
- **Viewer:** can read, but can't change work or settings.

Berry checks these permissions on every change.

### Email invitations

An owner or admin can invite someone by email as an admin, member or viewer. Nobody can be invited as an owner, and only an owner can invite an admin; the invite dialog only offers the roles you're allowed to grant. Berry doesn't send email itself. It creates a one-time link, shown once, that the admin copies and sends however they like. Berry only stores a scrambled (hashed) form of the link. Pending invitations are listed with their expiry and can be revoked.

### Accepting an invitation

Opening an invitation link shows the workspace, the offered role and the expiry, with *Accept invitation* and *Not now* buttons. *Not now* leaves the invitation open until it expires; to turn it down for good, use *Decline* next to it in the workspace menu. A link that's invalid, withdrawn, expired or meant for another account shows a deliberately vague "cannot be used" message, so nobody can use links to find out whether a workspace or invitation exists. Invitations addressed to your account also appear in the workspace menu, each with *Join* and *Decline*. There is also an *Invitations* page for accepting several at once, though nothing in the app links to it yet.

### Join links

A join link isn't tied to an email address. Anyone who has it can join at the role chosen when it was created. It can expire after 1, 7 or 30 days, or never expire. As with invitations, the link is shown once, only a hashed form is stored, and it can be revoked. You create join links under Settings → Members → Join links.

### Preferences

Your personal preferences include:

- display name, interface language (English is the only language today) and time zone (saved to your account, though most dates still follow your browser's clock)
- sidebar customization (pin, hide and reorder items, saved in your browser)
- reduced motion
- which fields the task composer shows
- a comment box that stays visible
- the floating chat panel

### Notification settings

Switches control which kinds of activity reach your inbox.

### Security and sessions

This page lists every device and browser signed in to your account, with a rough description, IP address and when it was last used. You can sign any of them out remotely. Berry has no passkeys or commit signing, so the page only covers sessions.

### Personal access tokens

You can create long-lived tokens that act as you against Berry's public API. A token can have full access or be limited to specific parts of the API, and it can expire after 30, 90 or 365 days or never. The secret is shown once and only its hash is stored. Tokens can be revoked instantly. They're managed under Settings → API tokens.

### Connected accounts

This personal page records addresses where Berry could reach you outside the product: email, SMS, WhatsApp, Telegram, Viber or live chat, with one preferred address per channel.

> **Partly working:** the page is clearly labelled "Not yet implemented". Addresses are saved and shown as unverified, but Berry doesn't verify them or send anything to them yet. This isn't how Berry reaches GitHub; that comes from signing in with GitHub.

### General workspace settings

Owners and admins set the workspace's:

- **Name**
- **Logo**, given as an image link, since Berry doesn't host uploads for logos
- **Description**, shown to people deciding whether to join
- **Agent context**: house rules given to every agent in the workspace

The address is permanent and shown read-only. The task prefix can be changed, but that renumbers every task reference at once, so Berry asks for confirmation and shows a before-and-after example. In the danger zone, a member can leave the workspace (unless they're the only owner), and an owner can delete it by typing its name to confirm.

### Agent permissions

Settings → Agents lists every agent in alphabetical order, with its model and how many permissions it has. Admins turn each agent's permissions on and off there; an agent's model, environment variables and avatar are changed on its own profile. An agent has five separate permissions for working in a repository: read the repository, create branches, run commands, open pull requests, and merge without approval. For an agent that fills a role in the organization, Berry refuses any permission above what its autonomy level allows. "Merge without approval" is off by default, marked as dangerous, and flagged in the agent list for any agent that has it. Despite its name, it merges nothing: it only removes the note on the agent's pull request saying a person must approve it before merging (see [No agent merges or closes work](#no-agent-merges-or-closes-work)). If a permission is revoked, that step isn't allowed in the agent's later runs.

### Runtime and organization settings

Runtimes have their own page under Settings. Organization settings, including weekly work discovery, are on a separate Organization page that the Settings menu doesn't list yet. Work proposals have no settings page of their own. They're described in [section 3](#runtimes) and [section 4](#the-organization-settings-page).

### Task labels, task fields and quick actions

Workspace-wide catalogues for labels, custom fields and quick actions are managed under Settings. See [Labels](#labels), [Custom fields](#custom-fields) and [Quick actions](#quick-actions).

---

## 7. Integrations, API and plugins

### Integrations and tool permissions

Settings → Integrations lists the services whose tools agents can use.

- **Berry's own tools** (read a task, comment, run a command, save a file) need no connection.
- **GitHub's tools** (read a repository, push a branch, open a pull request) use the GitHub access members gave Berry when they signed in with GitHub. There's no separate Connect step. The list also shows a merge entry, but no agent tool merges a pull request and nothing in Berry merges code.

For each tool, the list shows what kind of action it is (read, write, has an outside effect, or destructive) and whether it's on by default. The list is a reference: what an agent may actually do in a run is set by its autonomy level and its own permissions.

Agents reach GitHub through the access members gave when they signed in with GitHub, using an owner's sign-in first. The GitHub card shows *Connected* whenever a member's sign-in works, with a note that the connection comes from your team's GitHub sign-in.

> **Needs setup:** set the server's encryption key. Without it, this page can't show GitHub as connected and the repository picker won't load.

### Plugins

Plugins are outside extensions, installed from a link or by uploading a plugin package file. Installing takes two steps on purpose. First Berry shows everything the plugin asks for: permissions, events it wants to hear about, schedules, pages and agent tools. An admin approves that concrete list instead of trusting a bare link. When the plugin is installed, Berry generates a signing secret, shown once, that the plugin uses to confirm calls really come from Berry. Each plugin has its own page with an on/off switch, its secrets, switches for each agent tool, a list of recent calls, the keys it has saved, and uninstall. A plugin's agent tools stay off until an admin switches each one on in the plugin's page. Only those tools reach agent runs, with a credential limited to what the plugin was granted that expires within hours.

> **Needs setup:** needs the server's encryption key. Without it, plugins can't be installed.

### The plugin SDK

Berry ships a small Node.js toolkit for plugin authors. It includes a client for Berry's public API, a helper for receiving signed event and schedule calls (which rejects anything older than five minutes), and a helper for plugin pages shown inside Berry. Each call a plugin receives carries a short-lived token limited to what the plugin was granted. When a plugin writes something back to Berry, such as a comment, Berry also tells the plugin about the resulting event, so the plugin can recognise and ignore its own writes.

### The public API

Berry has a small public API for scripts and plugins, separate from the API the web app uses. With it you can see who a token belongs to and which workspaces it reaches, read a task or change its title, description, status or priority, and read or post comments. Plugins also get a small private store for their own saved values. It accepts personal access tokens and short-lived plugin tokens. Every call goes through the same permission checks as the main product and is recorded as done by the token's owner. For a plugin, that's the person who installed it.

---

## 8. How it runs, and why you can trust it

This section explains what happens behind the scenes, and why the promise that people stay in control rests on the design, not on good behaviour.

### Berry directs the work; it doesn't call the AI

The Berry server, which runs the web app, the database and the APIs, never talks to an AI model. It prepares a task, hands it to a separate runtime and records what comes back. A check script in the codebase fails if any AI model library is imported by the main server. This means an operator's model credentials are never exposed to the product server, and agent execution can be swapped or switched off without touching the tracker. In other words, Berry is a *control plane*: it decides what work happens, and something separate does the work.

### Runs happen on Amazon Bedrock AgentCore Runtime

When an agent picks up a task, Berry packages the task and sends it to Amazon Bedrock AgentCore Runtime, a managed service where each session runs in its own isolated micro virtual machine. Progress streams back to Berry as a sequence of events. The package always includes the conversation so far, rebuilt from Berry's own records, so a session that has to start fresh can pick up where it left off. What reaches people is the run's status, messages and tool calls, not the runtime machinery behind them.

> **Needs setup:** needs an AWS account with the runtime image built and published to AgentCore, which requires account-owner access. AgentCore must also be able to reach Berry's public address. Without a runtime, Berry reports that agent execution is unavailable.

### The same runtime over plain HTTP

Instead of AgentCore, an operator can run the same runtime image anywhere reachable over HTTP. Berry uses the same task package and the same progress events either way. If both are configured, AgentCore wins.

> **Needs setup:** the image still calls Amazon Bedrock for the model, so AWS model access is still needed.

### The agent loop

Inside the runtime, the "think, use a tool, look at the result, repeat" loop is built on the open-source Strands Agents SDK, using Claude models on Amazon Bedrock. This loop is what lets an agent read files, write code, run commands and comment over many steps instead of answering once. Each step is recorded in the run's event log as tool calls and messages.

> **Needs setup:** needs a runtime and Bedrock access.

### Models matched to the job

Roles are pre-matched to Claude tiers: Opus for the architect and CTO, Sonnet for most product and engineering roles, and Haiku for lighter analytical and writing roles. Each role also records suggested per-run limits on turns and tokens, but runs don't enforce them yet. Choosing an agent for a task therefore also chooses a sensible model, and any agent's model can be changed in its settings.

### Each run gets its own short-lived key

Every run receives its own access token, made for that run alone and valid for at most eight hours. It only works while the run is queued or running, it's revoked the moment the run ends, and it's checked against the database on every call: its hash, its expiry and the run's status.

### One narrow door into Berry

An agent never touches Berry's database. It can only call a fixed set of named tools, such as reading its task, listing files, writing a file, commenting, changing status or escalating, through one dedicated door that accepts only run tokens. Run tokens are refused everywhere else in Berry, and that door refuses every other kind of credential. The workspace, and the task a run is working on, come from the token itself, never from anything the model writes. When a tool names something else, such as a parent task, a project or another agent, Berry checks that it belongs to the same workspace. **An agent can't reach into another workspace even if it tries.** Every visible thing an agent does is one of these named, checked and logged calls.

### Autonomy levels are enforced at the moment of use

Before any tool runs, Berry checks it against the agent's autonomy level and contract. A role that tries to go beyond its level is refused with a "tool not allowed" error, no matter what its instructions say. This applies to agents created from the organization's roles; an agent you create by hand, or copy, has no autonomy level, so every agent tool is open to it. See [Autonomy levels](#autonomy-levels).

### People release the work

No autonomy level includes a merge tool, the status tool agents use can't choose *done* or *cancelled*, and no reviewer agent's verdict moves a task to *Done*. Peer and role reviews happen *before* work reaches a person, and they can send it back, but only a person clears it. Merging stays with people. Berry has no action that merges a pull request, so a person always merges in GitHub. This is the clearest human-in-control guarantee in Berry, and it's built into the structure.

### Secrets are encrypted

Every credential Berry stores for an outside system is encrypted before it's written and only decrypted in memory when used. Plugin secrets, agent environment variables, MCP server headers and connected-provider credentials are sealed with AES-256-GCM under the operator's encryption key. GitHub sign-in tokens are encrypted by the sign-in system with the server's sign-in secret. Tampered data fails to decrypt instead of producing garbage. If the operator hasn't set an encryption key, the features that need it are turned off rather than run without protection.

> **Needs setup:** the operator sets one encryption key.

### GitHub access, tightly held

Berry's GitHub access comes from members' GitHub sign-ins. Those tokens are stored encrypted, opened only when Berry needs to reach GitHub (to list and link repositories, or for a run to clone, push and open a pull request), and never shown in the app. When you pick or link a repository, Berry uses your own sign-in; for a run, it uses the sign-in of a workspace owner first, then an admin, then any member. Agents don't get free rein with them: cloning, pushing and opening a pull request are steps Berry carries out for a run, each allowed only if the agent has that permission, and nothing in Berry merges.

> **Needs setup:** needs GitHub sign-in configured on the server, and at least one workspace member who has signed in with GitHub.

### Workspaces are kept apart

Every session, every page of the app and every agent tool call is scoped to a single workspace. An agent's token carries its workspace, task and board, set by the server, so one workspace's agents can't read or change another workspace's data, even if a model tried to point at it.

### Live updates from a durable record

Open pages receive live updates (run progress, new comments, status changes) over a steady stream, one per board and one per workspace. Every change is written to a durable event table in PostgreSQL in the same transaction as the change itself, and the stream replays from that table. A page that reconnects can be caught up on up to a day of missed changes; older than that, the server can't replay them and the page has to load the current state again. Board pages simply fetch the latest data whenever their stream reconnects. There's code for a faster relay, but it isn't needed: without it, updates arrive within about half a second instead of instantly, and nothing is lost.

### A permanent record of every run

Everything a run does is recorded as an ordered, append-only list of events. A run's displayed status is simply computed from that list. Each event is saved in the same transaction as the notice that feeds live updates, so Berry never broadcasts something that didn't actually get saved. The same record powers the run transcript, the task history and what peer reviewers read.

### Usage and cost per run

Every model call a run makes is recorded with its tokens and priced, giving a cost per run that adds up per agent and per workspace on the Usage and Dashboard pages.

> **Needs setup:** fills in only once real runs happen.

### Files agents produce

Files a run produces or collects, such as generated files, diffs or attachments, are uploaded to Amazon S3 or any S3-compatible store. Each upload is checked for size and checksum before it's accepted and recorded against the run that made it. Downloads use signed, time-limited links.

> **Needs setup:** needs a storage bucket. Without one, file storage is turned off.

### Capability reporting

Berry's server has one endpoint that reports what this deployment is set up to do: whether agents can run, whether storage is set up, whether GitHub sign-in is configured, and whether the planner, metrics and live updates are available. It works from configuration: agents and the planner show as available once a runtime is configured, and it doesn't test that the runtime or other outside services are actually reachable. The app uses this report, and so can an operator or a judge inspecting a live server.

### Self-hosted, no containers required

Berry runs as a plain Node.js process with no build step, against your own PostgreSQL database, and the web app runs as a second ordinary process. No container stack is required. The only container is the agent runtime itself, which is packaged as an image and deployed to AWS Bedrock AgentCore. Several Berry servers can run side by side safely: runs are claimed with database locks so two servers never take the same run, and each scheduled autopilot slot fires once. On shutdown, Berry gives open requests a few seconds to finish and stops the runs it was executing. A running server, or this one when it restarts, then marks those runs as failed with a note that they can be retried, and frees their tasks so they aren't stuck.

### Health and monitoring

Berry has a liveness check, a readiness check that actually queries the database, and a Prometheus-format metrics endpoint that reports the running version and the number of runs in flight. Operators can connect these to a load balancer or a monitoring stack.

---

## What's next

These items come straight from the current code, not from a roadmap.

- **Delivering notifications outside Berry.** Connected accounts (email, SMS, WhatsApp, Telegram, Viber, live chat) are recorded but not yet verified or used. The page is labelled "Not yet implemented".- **More languages.** English is the only interface language today.
- **A faster live-update relay.** The code for instant cross-server updates exists but isn't switched on. Updates currently arrive within about half a second.
