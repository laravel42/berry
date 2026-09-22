/**
 * Shared story data for the shell, headers, inbox, approvals, proposals and
 * my-issues stories. Modelled on the "elian" dev workspace: one admin, a
 * teammate, a role agent, a handful of BERR tasks and the notifications they
 * produce. Nothing here is imported by the app.
 */
import { Box } from 'lucide-react';
import { http, HttpResponse } from 'msw';
import { pendingApproval } from '../../.storybook/msw-handlers';
import type { InboxItem } from '@/data/inbox';
import type { Issue } from '@/data/issues';
import type { LabelInterface } from '@/data/labels';
import { priorities, type Priority } from '@/data/priorities';
import { health, type Project } from '@/data/projects';
import { status, type Status } from '@/data/status';
import type { User } from '@/data/users';
import type { Agent } from '@/lib/agents';
import type { Approval } from '@/lib/approvals';
import type { WorkProposal } from '@/lib/organization';
import type { Pin } from '@/lib/pins';
import type { RunRecord } from '@/lib/runs';
import { useSessionStore, type SessionWorkspace } from '@/store/session-store';

/* -------------------------------------------------------------------------- */
/*                                   People                                   */
/* -------------------------------------------------------------------------- */

export const me: User = {
   id: 'user-1',
   name: 'Elian Rossi',
   avatarUrl: '',
   email: 'elian@berry.dev',
   status: 'online',
   role: 'Admin',
   joinedDate: '2026-02-03',
   teamIds: ['team-1'],
   timezone: 'Europe/Rome',
};

export const teammate: User = {
   id: 'user-2',
   name: 'Mara Okafor',
   avatarUrl: '',
   email: 'mara@berry.dev',
   status: 'away',
   role: 'Member',
   joinedDate: '2026-03-11',
   teamIds: ['team-1'],
   timezone: 'Europe/London',
};

/** A role agent as the task list shows it: an actor, not a member. */
export const backendAgent: User = {
   id: 'agent-1',
   name: 'Backend Engineer',
   avatarUrl: '',
   email: '',
   status: 'online',
   role: 'Application',
   joinedDate: '2026-02-03',
   teamIds: [],
   timezone: 'UTC',
};

function agent(fields: Partial<Agent> & Pick<Agent, 'id' | 'name'>): Agent {
   return {
      description: null,
      avatarUrl: null,
      status: 'available',
      capabilities: [],
      permissions: [],
      labels: [],
      envNames: [],
      conversationStarters: [],
      customized: false,
      createdAt: '2026-02-03T09:00:00Z',
      updatedAt: '2026-09-01T09:00:00Z',
      ...fields,
   };
}

/** Two of the organization's agents, as `GET /api/v1/agents` lists them. */
export const agents: Agent[] = [
   agent({
      id: 'agent-0',
      name: 'Orchestrator',
      description: 'Routes each task to the role that fits it best.',
      capabilities: ['orchestrate'],
      roleKey: 'orchestrator',
      department: 'leadership',
      autonomyLevel: 2,
      systemRole: 'orchestrator',
   }),
   agent({
      id: 'agent-1',
      name: 'Backend Engineer',
      description: 'Owns server-ts: migrations, repositories and the dispatcher.',
      roleKey: 'backend-engineer',
      department: 'engineering',
      autonomyLevel: 3,
   }),
];

/* -------------------------------------------------------------------------- */
/*                                  Session                                   */
/* -------------------------------------------------------------------------- */

export const workspace: SessionWorkspace = {
   id: 'ws-1',
   name: 'Elian',
   slug: 'elian',
   role: 'admin',
};

export const otherWorkspace: SessionWorkspace = {
   id: 'ws-2',
   name: 'Circle Labs',
   slug: 'circle',
   role: 'member',
};

/** Sign `me` in to the elian workspace with the given role. */
export function seedSession(role: string = 'admin') {
   useSessionStore.setState({
      status: 'ready',
      user: me,
      workspace: { ...workspace, role },
      workspaces: [{ ...workspace, role }, otherWorkspace],
      boardId: 'board-1',
      error: null,
   });
}

/** The route params most workspace pages read. */
export const workspaceRoute = (pathname: string, extra: [string, string][] = []) => ({
   pathname,
   segments: [['orgId', 'elian'], ...extra],
});

/* -------------------------------------------------------------------------- */
/*                                   Tasks                                    */
/* -------------------------------------------------------------------------- */

function pick<T extends { id: string }>(list: T[], id: string): T {
   const found = list.find((entry) => entry.id === id);
   if (!found) throw new Error(`Unknown fixture id ${id}`);
   return found;
}

export const statusOf = (id: string): Status => pick(status, id);
export const priorityOf = (id: string): Priority => pick(priorities, id);

export const labels: Record<'backend' | 'frontend' | 'bug', LabelInterface> = {
   backend: { id: 'label-1', name: 'backend', color: 'purple' },
   frontend: { id: 'label-2', name: 'frontend', color: 'blue' },
   bug: { id: 'label-3', name: 'bug', color: 'red' },
};

export const serverProject: Project = {
   id: 'proj-1',
   name: 'Berry Server',
   status: statusOf('in-progress'),
   icon: Box,
   percentComplete: 42,
   startDate: '2026-08-01',
   targetDate: '2026-10-15',
   lead: me,
   priority: priorityOf('high'),
   health: pick(health, 'on-track'),
   teamId: 'team-1',
   githubRepo: 'berry-dev/berry',
   createdAt: '2026-08-01T09:00:00Z',
   updatedAt: '2026-09-17T16:20:00Z',
};

export const webProject: Project = {
   ...serverProject,
   id: 'proj-2',
   name: 'Berry Web',
   percentComplete: 71,
   health: pick(health, 'at-risk'),
};

function issue(fields: Partial<Issue> & Pick<Issue, 'id' | 'identifier' | 'title'>): Issue {
   return {
      description: '',
      status: statusOf('to-do'),
      assignee: null,
      priority: priorityOf('no-priority'),
      labels: [],
      createdAt: '2026-09-10T09:00:00Z',
      updatedAt: '2026-09-17T15:00:00Z',
      creator: me,
      createdById: me.id,
      cycleId: '',
      rank: 'a3c',
      sortOrder: 0,
      ...fields,
   };
}

export const issues: Issue[] = [
   issue({
      id: 'issue-42',
      identifier: 'BERR-42',
      title: 'Persist project health',
      status: statusOf('in-progress'),
      priority: priorityOf('high'),
      assignee: me,
      labels: [labels.backend],
      project: serverProject,
      rank: 'a3c',
      sortOrder: 1,
   }),
   issue({
      id: 'issue-38',
      identifier: 'BERR-38',
      title: 'Move approvals and proposals into the inbox',
      status: statusOf('in-review'),
      priority: priorityOf('medium'),
      assignee: backendAgent,
      labels: [labels.frontend],
      project: webProject,
      rank: 'a3d',
      sortOrder: 2,
   }),
   issue({
      id: 'issue-51',
      identifier: 'BERR-51',
      title: 'Share the list filter across pages',
      status: statusOf('to-do'),
      priority: priorityOf('urgent'),
      assignee: teammate,
      creator: teammate,
      createdById: teammate.id,
      labels: [labels.frontend, labels.bug],
      project: webProject,
      rank: 'a3e',
      sortOrder: 3,
   }),
   issue({
      id: 'issue-17',
      identifier: 'BERR-17',
      title: 'Render run transcript steps in a code editor',
      status: statusOf('done'),
      priority: priorityOf('low'),
      assignee: me,
      labels: [labels.frontend],
      project: webProject,
      rank: 'a3f',
      sortOrder: 4,
   }),
];

/** What an agent's discovery sweep files into a fresh workspace's backlog. */
export const discoveryIssues: Issue[] = [
   issue({
      id: 'issue-60',
      identifier: 'BERR-60',
      title: 'Discovery: audit unused environment variables',
      status: statusOf('backlog'),
      creator: backendAgent,
      createdById: backendAgent.id,
      createdBy: backendAgent,
      rank: 'a3g',
      sortOrder: 5,
   }),
   issue({
      id: 'issue-61',
      identifier: 'BERR-61',
      title: 'Discovery: add a migration checksum test',
      status: statusOf('backlog'),
      creator: backendAgent,
      createdById: backendAgent.id,
      createdBy: backendAgent,
      rank: 'a3h',
      sortOrder: 6,
   }),
];

/* -------------------------------------------------------------------------- */
/*                                   Inbox                                    */
/* -------------------------------------------------------------------------- */

function notification(
   fields: Partial<InboxItem> & Pick<InboxItem, 'id' | 'title' | 'type'>
): InboxItem {
   return {
      identifier: '',
      content: fields.title,
      category: 'tasks',
      eventType: 'issue.updated',
      severity: 'info',
      user: me,
      actor: null,
      timestamp: '2026-09-18T11:00:00Z',
      read: false,
      archived: false,
      issueDeleted: false,
      ...fields,
   };
}

function issueRef(identifier: string): Issue {
   const found = issues.find((entry) => entry.identifier === identifier);
   if (!found) throw new Error(`Unknown fixture task ${identifier}`);
   return found;
}

export const inboxItems: InboxItem[] = [
   notification({
      id: 'n-1',
      type: 'assignment',
      identifier: 'BERR-51',
      title: 'Share the list filter across pages',
      content: 'Mara assigned this task to you.',
      eventType: 'issue.assigned',
      category: 'assignments',
      actor: { id: teammate.id, type: 'user' },
      timestamp: '2026-09-18T11:50:00Z',
      issue: issueRef('BERR-51'),
      issueId: 'issue-51',
   }),
   notification({
      id: 'n-2',
      type: 'mention',
      identifier: 'BERR-42',
      title: 'Persist project health',
      content: 'Mara mentioned you in a comment.',
      eventType: 'comment.mentioned',
      category: 'mentions',
      actor: { id: teammate.id, type: 'user' },
      timestamp: '2026-09-18T11:20:00Z',
      issue: issueRef('BERR-42'),
      issueId: 'issue-42',
      commentId: 'comment-7',
      commentBody:
         '@elian the migration adds the column as nullable — can you confirm the backfill should read the last update?',
   }),
   notification({
      id: 'n-3',
      type: 'approval',
      title: pendingApproval.title,
      content: 'The Backend Engineer is waiting for a decision before it starts.',
      eventType: 'approval.requested',
      category: 'approvals',
      severity: 'warning',
      actor: { id: 'agent-1', type: 'agent' },
      timestamp: '2026-09-18T09:30:00Z',
      approval: { id: pendingApproval.id },
   }),
   notification({
      id: 'n-4',
      type: 'runFailed',
      title: 'Run failed on the health migration',
      content:
         'The agent stopped after the migration checksum check failed: 0042_project_health.sql was edited after it was applied.',
      eventType: 'run.failed',
      category: 'runs',
      severity: 'critical',
      actor: { id: 'agent-1', type: 'agent' },
      timestamp: '2026-09-18T08:05:00Z',
      read: true,
      issueId: 'issue-42',
      prompt:
         'Add a forward-only migration for project health and backfill it from the latest update.',
   }),
   notification({
      id: 'n-5',
      type: 'goal',
      title: 'Goal “Ship the inbox” is blocked',
      content: 'Two tasks under this goal are waiting on review.',
      eventType: 'goal.blocked',
      category: 'goals',
      timestamp: '2026-09-17T17:40:00Z',
      read: true,
      goal: { id: 'goal-1' },
   }),
   notification({
      id: 'n-6',
      type: 'closed',
      identifier: 'BERR-17',
      title: 'Render run transcript steps in a code editor',
      content: 'Marked done.',
      eventType: 'issue.closed',
      category: 'statuschanges',
      actor: { id: me.id, type: 'user' },
      timestamp: '2026-09-16T10:00:00Z',
      read: true,
      issue: issueRef('BERR-17'),
      issueId: 'issue-17',
   }),
];

export const archivedItems: InboxItem[] = [
   notification({
      id: 'n-20',
      type: 'reviewRequested',
      identifier: 'BERR-38',
      title: 'Move approvals and proposals into the inbox',
      content: 'The Backend Engineer asked for your review.',
      eventType: 'review.requested',
      timestamp: '2026-09-12T14:00:00Z',
      read: true,
      archived: true,
      issueId: 'issue-38',
   }),
];

/* -------------------------------------------------------------------------- */
/*                            Approvals & proposals                           */
/* -------------------------------------------------------------------------- */

export const approvals: Approval[] = [
   pendingApproval,
   {
      ...pendingApproval,
      id: 'appr-2',
      kind: 'work_proposal',
      risk: 'high',
      title: 'Proposal: rotate the integration encryption key',
      description: 'The key has not been rotated since the workspace was created.',
      issueId: 'issue-70',
      issue: { id: 'issue-70', identifier: 'BERR-70', title: 'Rotate the encryption key' },
      requestedAt: '2026-09-18T07:15:00Z',
   },
   {
      ...pendingApproval,
      id: 'appr-3',
      risk: 'low',
      title: 'Start BERR-17: render run transcript steps in a code editor',
      issueId: 'issue-17',
      issue: { id: 'issue-17', identifier: 'BERR-17', title: 'Render run transcript steps' },
      status: 'approved',
      resolvedBy: me.id,
      resolvedAt: '2026-09-15T10:00:00Z',
      requestedAt: '2026-09-15T09:40:00Z',
   },
];

export const proposals: WorkProposal[] = [
   {
      id: 'prop-1',
      taskId: 'issue-70',
      identifier: 'BERR-70',
      approvalId: 'appr-2',
      roleKey: 'security-engineer',
      proposedBy: 'agent-2',
      problem: 'The integration encryption key has never been rotated.',
      evidence: [
         { kind: 'config', ref: 'INTEGRATION_ENCRYPTION_KEY', excerpt: 'set 2026-02-03' },
         { kind: 'file', ref: 'server-ts/src/integrations/seal.ts' },
      ],
      impact: 'A leaked key would expose every sealed provider secret in the workspace.',
      severity: 'high',
      impactClasses: ['security'],
      proposedAction: 'Add a key-version column and re-seal secrets under a new key.',
      effort: 'M',
      dependencies: [],
      responsibleRole: 'Security Engineer',
      requiredReviewers: ['Backend Engineer', 'Platform Lead'],
      status: 'proposed',
      createdAt: '2026-09-18T07:15:00Z',
   },
   {
      id: 'prop-2',
      taskId: 'issue-71',
      identifier: 'BERR-71',
      approvalId: 'appr-4',
      roleKey: 'qa-engineer',
      proposedBy: 'agent-3',
      problem: 'Inbox keyboard navigation has no test coverage.',
      evidence: [{ kind: 'coverage', ref: 'components/common/inbox/use-inbox.ts', excerpt: '0%' }],
      impact: 'A regression in J/K or E would ship unnoticed.',
      severity: 'low',
      impactClasses: ['quality'],
      proposedAction: 'Add interaction tests for the inbox keyboard.',
      effort: 'S',
      dependencies: [],
      responsibleRole: 'QA Engineer',
      requiredReviewers: [],
      status: 'proposed',
      createdAt: '2026-09-17T12:00:00Z',
   },
];

/* -------------------------------------------------------------------------- */
/*                                 Shell data                                 */
/* -------------------------------------------------------------------------- */

export const pins: Pin[] = [
   {
      id: 'pin-1',
      targetType: 'issue',
      targetId: 'issue-42',
      position: 0,
      title: 'Persist project health',
      identifier: 'BERR-42',
   },
   {
      id: 'pin-2',
      targetType: 'project',
      targetId: 'proj-1',
      position: 1,
      title: 'Berry Server',
      identifier: null,
   },
   {
      id: 'pin-3',
      targetType: 'view',
      targetId: 'view-1',
      position: 2,
      title: 'Urgent frontend',
      identifier: null,
   },
];

/** A working session's strip: the task list, a task, and the inbox. */
export const runningRun: RunRecord = {
   id: 'run-1',
   issueId: 'issue-42',
   agentId: 'agent-1',
   status: 'running',
   sequence: 3,
   summary: null,
   usage: {
      inputTokens: 18200,
      outputTokens: 2400,
      totalTokens: 20600,
      costMicros: null,
      currency: null,
   },
   failure: null,
   source: 'assignment',
   requestedBy: { type: 'user', id: me.id },
   createdAt: '2026-09-18T11:40:00Z',
   startedAt: '2026-09-18T11:41:00Z',
   completedAt: null,
};

const emptyConnection = { nodes: [], pageInfo: { hasNextPage: false, endCursor: null } };

/**
 * The calls the shell makes on mount, answered with the fixtures above: pins,
 * chat threads, invitations, other workspaces' unread counts, inbox writes.
 */
export const shellHandlers = [
   http.get('*/api/v1/pins', () => HttpResponse.json({ nodes: pins })),
   http.delete('*/api/v1/pins/:id', () => new HttpResponse(null, { status: 204 })),
   http.get('*/api/v1/conversations', () => HttpResponse.json({ nodes: [] })),
   http.get('*/api/v1/invitations/pending', () => HttpResponse.json({ nodes: [] })),
   http.get('*/api/v1/inbox/unread-count', () => HttpResponse.json({ count: 3 })),
   http.post('*/api/v1/inbox/bulk', () => HttpResponse.json({})),
   http.post('*/api/v1/inbox/:id/:action', () => HttpResponse.json({})),
   http.get('*/api/v1/agents', () => HttpResponse.json(emptyConnection)),
   http.get('*/api/v1/issues/:ref/runs', () => HttpResponse.json(emptyConnection)),
   http.get('*/api/v1/issues/:ref/subscribers', () =>
      HttpResponse.json({ nodes: [], subscribed: true })
   ),
];

export { emptyConnection, pendingApproval };
