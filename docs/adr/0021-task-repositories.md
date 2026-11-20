# ADR-0021: A task names its repository; the project's is the default

- **Status:** Implemented
- **Date:** 2026-11-20
- **Deciders:** Berry maintainers
- **Related:** migrations `017_project_github_repo`, `256_project_gitlab_repo`,
  `262_issue_repository`; [ADR-0014](0014-agentcore-runtime-control-plane.md)
  (runs are tasks the server hands to a runtime)

## Current state

A task (`issues`) carries its own repository: one GitHub
(`github_repo_id`, `github_repo_full_name`) or one GitLab
(`gitlab_project_id`, `gitlab_project_path`) repository, never both, in the
same shape and constraints as a project's. Everything that acts on code reads
the task's repository: what a run checks out (`envelope-builder.ts`,
`runs/ledger.ts`, `runtime/companion.ts`, `agents/repository-context.ts`),
the review queue and pull-request lookups (`core/review-queue.ts`), conflict
checks, GitHub issue mirroring (`scm/sync.ts`) and the `read_task` agent tool.

A project keeps its repository as the **default** its tasks start from
(`core/issue-repository.ts`):

- A task takes its project's repository when it is created in a project,
  joins one, or its project's repository changes, but only if the task had
  none or still held the project's previous one. A repository chosen for the
  task itself is never overwritten that way.
- A sub-task takes its parent's repository, else its project's.
- Leaving a project keeps the task's repository.
- A repository named when the task is created wins over the default.

The API carries it as `repository: { provider: "github" | "gitlab", fullName }`
or null on the issue resource, and accepts it on `POST` and `PATCH
/api/v1/issues`. A name is resolved through its host before it is stored, as
a project's is, so the id/name pair always agrees.

The project still owns what is about the project: its default repository,
its verify commands (run only while a task is in the project's own
repository, since they were written for that codebase), milestone mirroring,
`read_project_resources` and `list_projects`.

## Context

A task reached a repository only through its project
(`issue_project_links` → `projects.github_repo_*`). Every task in a project
therefore checked out the same code, and a project spanning a frontend, a
backend and an infrastructure repository could not say which one a task was
about. A task in no project had no repository at all.

## Decision

Store the repository on the task, and keep the project's as a default rather
than removing it. Removing it would have broken project creation, settings,
GitHub import and verify commands for no gain: most tasks in a project do
work in its main repository, and the default keeps that the zero-effort case.

Migration 262 copies each project's repository onto its live tasks, so runs
check out the same code after the change as before it.

## Consequences

- A task can be worked in any repository the workspace reaches, with or
  without a project.
- Changing a project's repository moves only the tasks still following it.
  Those writes do not publish per-task events, so an open task view shows the
  old repository until it reloads.
- Agents can link a repository to a project (`link_repository`) but not yet to
  a single task.
- The VS Code companion still matches open folders against the project's
  repository.
