## What a loop is
A loop is a standing instruction an agent carries out for you: on a schedule, when something happens in Berry, when another service calls a webhook, or when you press **Run now**. Each time it fires is a **run**. A run opens its own task (or works a task you chose), the agent does the work there, and the result waits in review for a person, like any other agent work.

Loops never release work. No loop can merge a pull request, mark a task Done or cancel it. Those stay a person's decision.

## Create a loop
Open **Loops** in the sidebar (`g` then `l`) and choose **New loop** (`n`).

1. Describe what you want under **What should Berry automate?**, for example *Every weekday at 9 AM, review open bugs and suggest priorities*, then choose **Draft loop** (`⌘↵`). If your workspace has a connected model, it drafts the loop; otherwise Berry reads common phrasings itself. Either way you get a form to review. Nothing is created yet.
2. Or start from a template: triage new bugs, review linked pull requests, check project health, summarize the week, detect blocked work, prioritize the backlog, analyze failed agent runs, or prepare QA review. Each template suggests an agent from your workspace by role.
3. Or choose **Start from scratch**.

Review the name, the agent, the instructions and **When it runs**, then choose **Create loop**. Tick **Create paused** to set it up without letting it run yet.

Write instructions as the outcome you want and what the agent must not change. Facts about the event that started a run are added after your instructions automatically, marked as data.

## Triggers
| Trigger | Fires when |
| --- | --- |
| Schedule | A five-field cron in your time zone comes round. Missed times while Berry was down collapse into one run. |
| Event | Something happens in Berry: a task is created, changes status, is assigned, started or completed; a comment is added; a project is created or updated; an agent run succeeds or fails; an approval is requested; a pull request linked to a task changes. |
| Webhook | Another service posts to the loop's signed URL. The URL and secret are shown once. |
| Run now | You press it. It works while the loop is paused. |

An event trigger can have up to eight filters, combined **Match all** or **Match any**: project, status, previous status, priority, label, assignee, who did it, which field changed, and the pull request's state. A filter the event cannot answer is not offered.

A loop hears only what happens after its trigger is created.

## Access and limits
Every loop has an **Access** mode. Neither mode gives the agent more than its own role allows.

- **Recommend** (the default). The agent reads, comments, writes files on its own task, proposes work for a person to accept, and escalates. It cannot change other tasks, delegate, run commands or write to the repository.
- **Act**. The agent uses everything its role allows. Turn it on only for work you would let that agent do unasked.

Under **Limits**:

- **One run at a time** skips a firing while an earlier run is still queued or running.
- **Turn limit** and **Time limit** stop a run that goes on too long. A run over its time limit is cancelled and shows as *Timed out*.
- **Answer events caused by agents** is off by default, so only what people do fires the loop. Turn it on for triggers agents usually cause, such as an agent run failing.
- **Chain depth** is how many other loops' work may lead to this one. At 0 (the default) a loop answers only people, schedules and webhooks. The most is 3.

A loop never answers its own runs, however many steps away.

## Follow what a loop does
The **Loops** page shows how many loops are active, how many runs happened this week, and the runs that **need attention**: failures nobody has retried yet, each with **Retry**.

On a loop's page:

- **Overview**: last and next run, the agent, access, limits and instructions.
- **Triggers**: add, edit, pause or remove triggers.
- **Runs**: every run, newest first, with its state.
- **Events**: every event the loop heard and what became of it: fired, filtered out, or skipped and why (its own work, chain limit, caused by an agent, already running, too many events).

Open a run to see its live timeline (the tool calls, commands, results and errors from the agent's run), the trigger data, the agent and model, tokens and cost where the runtime reports them, which loop runs led to it or followed from it, and the report.

| State | Meaning |
| --- | --- |
| Queued | Waiting for a runtime. |
| Running | The agent is working. |
| Waiting for approval | The agent finished; its work waits in review for a person. |
| Succeeded | Done and released. |
| Failed | The run, or queueing it, failed. |
| Canceled | Someone cancelled it. |
| Timed out | Berry cancelled it at the time limit. |
| Skipped | It did not run: paused, over quota, already running, or a loop rule. |

**Cancel** asks a queued or running agent to stop. **Retry** runs a failed, cancelled or timed-out run again once, with the same facts and on the same task.

## Manage loops
From the list or a loop's page you can pause and resume, edit, **Duplicate** (the copy starts paused and keeps its schedule and event triggers, but not webhooks), and archive. Archived loops keep their history and can be restored.

Project pages can link to `/loops?project=<id>` to show only that project's loops.

## Requirements
A loop needs an agent with a connected AI runtime, like any agent run. If the agent has none, the loop's page says so and runs fail with *Connect an AI runtime*. Drafting from a sentence uses a model only when one is connected.

Loops were called autopilots; old `/autopilots` links still work.
