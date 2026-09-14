# Product

- 2026-09-14 — **Supersedes entries below.** Berry is the control plane and
  imports no model SDK (ADR-0014, supersedes ADR-0008's in-process Google
  ADK). Agent loops run in an AgentCore Runtime container or the same image
  over HTTP. Every workspace is provisioned with a default organization: the
  Orchestrator plus 18 role agents, each with a contract, autonomy level
  (1-5), delegation/escalation rules and required reviewers. Agents cannot
  set a task to done or cancelled and have no merge tool — a person always
  decides release. ADR-0010 (goals) is now Implemented.
- 2026-08-22 — Core motion: task → assign (person or agent) → work → human
  review gate → done.
- 2026-09-01 — Projects are the authored container where planning starts;
  goals are a read-only surface derived from a project's tasks (ADR-0010,
  proposed).
