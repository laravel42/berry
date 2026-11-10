import type { Conditions, LoopEventKey } from './event-triggers.ts';
import type { AccessMode } from './policy.ts';

/**
 * Starting points for a Loop. A template fills the creation form; nothing is
 * created until a person reviews it and presses Create, and every field stays
 * editable.
 *
 * A template names roles, not agents: "the workspace's QA Engineer, else its
 * Software Engineer, else the Orchestrator". The Orchestrator is the one role
 * every workspace has, so a template always resolves to somebody. No model or
 * provider is named — the agent's tier and the workspace's connected runtime
 * decide that, as for any other run (ADR-0019).
 *
 * Every template starts in recommend mode. A person who wants a Loop to
 * change things turns that on, knowingly.
 */

export type TemplateTrigger =
   | { kind: 'cron'; expression: string; description: string }
   | { kind: 'event'; eventType: LoopEventKey; conditions: Conditions; description: string };

export interface LoopTemplate {
   key: string;
   name: string;
   description: string;
   category: 'triage' | 'review' | 'health' | 'reporting' | 'quality';
   instructions: string;
   trigger: TemplateTrigger;
   /** Roles in order of preference; the first one the workspace has is suggested. */
   roles: string[];
   /** What the run needs to be useful, said plainly. */
   requires: string[];
   accessMode: AccessMode;
   /**
    * Whether events an agent caused may fire it. On for triggers that agent
    * work normally causes (a run failing, a task reaching review); the chain
    * limit still applies, and a Loop never answers its own runs.
    */
   allowAgentEvents: boolean;
}

const REPORT =
   'End with a short report: what you looked at, what you found, and what you recommend. ' +
   'Recommend; do not change tasks you were not asked to change.';

export const LOOP_TEMPLATES: readonly LoopTemplate[] = [
   {
      key: 'bug-triage',
      name: 'Triage new bugs',
      description: 'When a bug is reported, assess its severity, look for related work and a likely cause, and recommend who should take it.',
      category: 'triage',
      instructions:
         'A new bug was reported (see the trigger context). Read it with read_task. Assess its severity from what it describes, ' +
         'search the open tasks for duplicates or related work, and, if the project has a repository, look for the likely root ' +
         'cause. Recommend a priority and the person or role best placed to fix it, and say how confident you are. ' +
         REPORT,
      trigger: {
         kind: 'event',
         eventType: 'issue.created',
         conditions: { match: 'all', rules: [{ field: 'label', op: 'in', values: ['bug'] }] },
         description: 'When a task labelled “bug” is created',
      },
      roles: ['qa-engineer', 'software-engineer', 'orchestrator'],
      requires: ['A “bug” label on reported bugs', 'A linked repository, for root-cause analysis'],
      accessMode: 'recommend',
      allowAgentEvents: false,
   },
   {
      key: 'pull-request-review',
      name: 'Review linked pull requests',
      description: 'When a pull request linked to a task changes, check it against the task and write a QA report.',
      category: 'review',
      instructions:
         'A pull request linked to a task changed (see the trigger context). Read the task with read_task and the changed code ' +
         'with browse_repository and read_repository_file. Check the implementation against what the task asked for: missing ' +
         'cases, risky changes, tests that should exist. Write a QA report with concrete, checkable findings. ' +
         REPORT,
      trigger: {
         kind: 'event',
         eventType: 'github.pull_request.updated',
         conditions: { match: 'all', rules: [{ field: 'pullRequestState', op: 'in', values: ['open'] }] },
         description: 'When an open pull request linked to a task changes',
      },
      roles: ['reviewer', 'qa-engineer', 'orchestrator'],
      requires: ['The GitHub App connected', 'Pull requests linked to tasks'],
      accessMode: 'recommend',
      allowAgentEvents: false,
   },
   {
      key: 'daily-project-health',
      name: 'Check project health',
      description: 'Every weekday morning, review active projects for stalled work, missing owners and slipping dates.',
      category: 'health',
      instructions:
         'Review every active project with list_projects and list_tasks. For each, note work that has not moved in several days, ' +
         'tasks with no owner, blocked tasks and what blocks them, and milestones at risk. Rank what needs a person’s attention ' +
         'first. ' +
         REPORT,
      trigger: { kind: 'cron', expression: '0 9 * * 1-5', description: 'Weekdays at 09:00' },
      roles: ['engineering-manager', 'product-lead', 'orchestrator'],
      requires: ['Projects with tasks'],
      accessMode: 'recommend',
      allowAgentEvents: false,
   },
   {
      key: 'weekly-summary',
      name: 'Summarize the week',
      description: 'Every Friday afternoon, summarize completed work, open risks and what to prioritize next.',
      category: 'reporting',
      instructions:
         'Summarize this week in the workspace: tasks completed (grouped by project), agent runs that failed and why, work that ' +
         'is blocked or at risk, and three priorities you recommend for next week with a reason for each. Keep it short enough ' +
         'to read in two minutes.',
      trigger: { kind: 'cron', expression: '0 16 * * 5', description: 'Fridays at 16:00' },
      roles: ['product-lead', 'engineering-manager', 'orchestrator'],
      requires: [],
      accessMode: 'recommend',
      allowAgentEvents: false,
   },
   {
      key: 'blocked-tasks',
      name: 'Detect blocked work',
      description: 'When a task becomes blocked, find out what is holding it and propose a way to unblock it.',
      category: 'health',
      instructions:
         'A task moved to Blocked (see the trigger context). Read it, its dependencies (list_dependencies) and its latest ' +
         'comments. Work out what is actually holding it and who can release it, and propose the smallest next step that would ' +
         'unblock it. ' +
         REPORT,
      trigger: {
         kind: 'event',
         eventType: 'issue.status_changed',
         conditions: { match: 'all', rules: [{ field: 'status', op: 'in', values: ['blocked'] }] },
         description: 'When a task’s status changes to Blocked',
      },
      roles: ['engineering-manager', 'orchestrator'],
      requires: [],
      accessMode: 'recommend',
      allowAgentEvents: true,
   },
   {
      key: 'backlog-prioritization',
      name: 'Prioritize the backlog',
      description: 'Every Monday, review the backlog and propose an order, with reasons.',
      category: 'triage',
      instructions:
         'Review the tasks in Backlog and Todo with list_tasks. Propose a priority order for the top ten, with a one-line reason ' +
         'for each, and flag duplicates and tasks that are too vague to start. Use propose_work only for work that is clearly ' +
         'missing. ' +
         REPORT,
      trigger: { kind: 'cron', expression: '0 9 * * 1', description: 'Mondays at 09:00' },
      roles: ['product-lead', 'planner', 'orchestrator'],
      requires: ['Tasks in the backlog'],
      accessMode: 'recommend',
      allowAgentEvents: false,
   },
   {
      key: 'run-failure-analysis',
      name: 'Analyze failed agent runs',
      description: 'When an agent run fails, explain why and recommend a fix.',
      category: 'quality',
      instructions:
         'An agent run failed (see the trigger context). Read the task it worked with read_task, including its latest comments. ' +
         'Explain the most likely cause in plain terms — a missing connection, an unclear task, a failing command, a limit — and ' +
         'recommend what a person should change before running it again. ' +
         REPORT,
      trigger: {
         kind: 'event',
         eventType: 'run.failed',
         conditions: { match: 'all', rules: [] },
         description: 'When an agent run fails',
      },
      roles: ['devops-engineer', 'orchestrator'],
      requires: [],
      accessMode: 'recommend',
      allowAgentEvents: true,
   },
   {
      key: 'qa-review-prep',
      name: 'Prepare QA review',
      description: 'When a task moves to In review, draft the checks a reviewer should run.',
      category: 'quality',
      instructions:
         'A task moved to In review (see the trigger context). Read it and what was delivered. Draft a QA checklist a reviewer ' +
         'can follow: the behaviour to check, edge cases, and how to verify each. Post it as a comment on that task. ' +
         REPORT,
      trigger: {
         kind: 'event',
         eventType: 'issue.status_changed',
         conditions: { match: 'all', rules: [{ field: 'status', op: 'in', values: ['inReview'] }] },
         description: 'When a task’s status changes to In review',
      },
      roles: ['qa-engineer', 'reviewer', 'orchestrator'],
      requires: [],
      accessMode: 'recommend',
      allowAgentEvents: true,
   },
];

export function findTemplate(key: string): LoopTemplate | undefined {
   return LOOP_TEMPLATES.find((template) => template.key === key);
}
