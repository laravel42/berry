## Projects, Goals, and tasks
| Concept | Purpose |
| --- | --- |
| Workspace | Membership, settings, and shared work for a team. |
| Project | Related work, a lead, dates, status, and an optional repository. |
| Goal | An outcome or milestone with linked tasks, progress, plans, and approvals. |
| Task | An individual unit of work with a description, status, priority, and assignee. API and database names use “issue.” |
| Board | The status columns and shared location for tasks. |
| Plan | A proposal that is validated before it is compiled into Goals and tasks. |
| Run | One execution attempt, with lifecycle events, output, usage, and a terminal status. |

## Assignment and execution
A task can be assigned to a person or an agent. Assignment identifies responsibility; a run records an execution attempt. A queued task is waiting to execute. It is not evidence that a model is currently working.

## Descriptions and acceptance criteria
Use the task description to state the problem, intended outcome, scope, and how the result will be checked. Organization delegation includes acceptance criteria in the description. Reviews compare the delivered work with the request.

## Plans and dependencies
A plan can contain multiple milestones. Compiling it creates the corresponding Goals, tasks, dependency edges, and approval requests. Dependencies define which work must happen first. Read [Planning and automation](planning.html) for the exact start and approval behavior.

## Human acceptance
Agents can propose, implement, and review. Their tools do not mark tasks done or merge code. The existing human review gate remains the release decision.
