/**
 * Shared story data for components/common/issues.
 *
 * Modelled on what the stores hold once `useHydrateWorkspaceData` has mapped
 * `/api/v1/issues`, members, agents, labels and projects through lib/*.ts: a
 * small workspace of three people and four agents, a label catalogue, one
 * project and a queue of tasks spread over every status and priority, two of
 * them with an agent run in flight.
 *
 * `seedIssuesWorkspace()` puts all of it into the stores and resets the
 * momentary ones (selection, display, layout), so a story starts from the
 * same place whatever ran before it in the same browser.
 */
import type { Issue, IssueDependencyRef } from '@/data/issues';
import type { LabelInterface } from '@/data/labels';
import { priorities, type Priority } from '@/data/priorities';
import { health, type Project } from '@/data/projects';
import { status as allStatus, type Status } from '@/data/status';
import type { User } from '@/data/users';
import type { Agent } from '@/lib/agents';
import type { ApiAttachment } from '@/lib/attachments';
import type { ApiComment } from '@/lib/comments';
import type { RunRecord } from '@/lib/runs';
import { useAgentsStore } from '@/store/agents-store';
import { useDisplaySettingsStore } from '@/store/display-settings-store';
import { useIssueSelectionStore } from '@/store/issue-selection-store';
import { useIssuesStore } from '@/store/issues-store';
import { useLabelsStore } from '@/store/labels-store';
import { useMembersStore } from '@/store/members-store';
import { usePinsStore } from '@/store/pins-store';
import { useProjectsStore } from '@/store/projects-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useRunsStore } from '@/store/runs-store';
import { useSessionStore } from '@/store/session-store';
import { useViewStore, type ViewType } from '@/store/view-store';
import { FolderKanban } from 'lucide-react';
import { http, HttpResponse } from 'msw';

/* --------------------------------- People -------------------------------- */

function person(id: string, name: string, email: string, status: User['status']): User {
   return {
      id,
      name,
      avatarUrl: '',
      email,
      status,
      role: 'Member',
      joinedDate: '2026-01-12',
      teamIds: [],
      timezone: 'Europe/Rome',
   };
}

export const andrea: User = {
   ...person('user-1', 'Andrea Lunelio', 'andrea@berry.dev', 'online'),
   role: 'Admin',
};
export const maya = person('user-2', 'Maya Chen', 'maya@berry.dev', 'away');
export const tomas = person('user-3', 'Tomás Ferreira', 'tomas@berry.dev', 'offline');

export const storyMembers: User[] = [andrea, maya, tomas];

/* --------------------------------- Agents -------------------------------- */

function agent(id: string, name: string, roleKey: string | null, status = 'available'): Agent {
   return {
      id,
      name,
      description: null,
      avatarUrl: null,
      status,
      capabilities: [],
      instructions: null,
      modelProvider: 'bedrock',
      modelName: 'us.anthropic.claude-haiku-4-5-20251001-v1:0',
      permissions: ['comment', 'set_status'],
      labels: [],
      envNames: [],
      systemRole: null,
      ownerId: null,
      conversationStarters: [],
      maxConcurrency: null,
      archivedAt: null,
      createdAt: '2026-06-01T09:00:00Z',
      updatedAt: '2026-09-01T09:00:00Z',
      roleKey,
      department: roleKey ? 'engineering' : null,
      autonomyLevel: roleKey ? 3 : null,
      customized: false,
      contract: null,
   };
}

export const orchestratorAgent = agent('agent-orch', 'Orchestrator', 'orchestrator');
export const backendAgent = agent('agent-be', 'Backend Engineer', 'backend_engineer');
export const frontendAgent = agent('agent-fe', 'Frontend Engineer', 'frontend_engineer');
export const qaAgent = agent('agent-qa', 'QA Engineer', 'qa_engineer');

export const storyAgents: Agent[] = [orchestratorAgent, backendAgent, frontendAgent, qaAgent];

/** An agent as an assignee, the way `agentToUser` maps it. */
export function agentUser(entry: Agent): User {
   return {
      id: entry.id,
      name: entry.name,
      avatarUrl: '',
      email: '',
      status: 'offline',
      role: 'Application',
      joinedDate: '',
      teamIds: [],
      timezone: 'UTC',
   };
}

/* ------------------------------ Vocabularies ----------------------------- */

export const statusById = (id: string): Status => allStatus.find((entry) => entry.id === id)!;
export const priorityById = (id: string): Priority => priorities.find((entry) => entry.id === id)!;

export const bugLabel: LabelInterface = { id: 'label-bug', name: 'Bug', color: '#e5484d' };
export const frontendLabel: LabelInterface = {
   id: 'label-frontend',
   name: 'Frontend',
   color: '#3e63dd',
};
export const backendLabel: LabelInterface = {
   id: 'label-backend',
   name: 'Backend',
   color: '#30a46c',
};
export const securityLabel: LabelInterface = {
   id: 'label-security',
   name: 'Security',
   color: '#f5a524',
};
export const storyLabels: LabelInterface[] = [bugLabel, frontendLabel, backendLabel, securityLabel];

/* -------------------------------- Projects ------------------------------- */

export const healthProject: Project = {
   id: 'project-health',
   name: 'Project health',
   status: statusById('in-progress'),
   icon: FolderKanban,
   percentComplete: 40,
   startDate: '2026-08-01',
   targetDate: '2026-10-15',
   lead: andrea,
   priority: priorityById('high'),
   health: health.find((entry) => entry.id === 'on-track')!,
   teamId: 'ws-1',
   githubRepo: 'berry-dev/berry',
   createdAt: '2026-08-01T09:00:00Z',
   updatedAt: '2026-09-17T09:00:00Z',
};

export const inboxProject: Project = {
   ...healthProject,
   id: 'project-inbox',
   name: 'Unified inbox',
   status: statusById('to-do'),
   percentComplete: 0,
   priority: priorityById('medium'),
   health: health.find((entry) => entry.id === 'at-risk')!,
};

export const storyProjects: Project[] = [healthProject, inboxProject];

/* --------------------------------- Tasks --------------------------------- */

let order = 0;
function task(
   number: number,
   title: string,
   overrides: Partial<Issue> & { statusId: string; priorityId: string }
): Issue {
   const { statusId, priorityId, ...rest } = overrides;
   order += 1;
   return {
      id: `issue-${number}`,
      identifier: `BERR-${number}`,
      title,
      description: '',
      status: statusById(statusId),
      assignee: null,
      priority: priorityById(priorityId),
      labels: [],
      createdAt: '2026-09-10T09:00:00Z',
      updatedAt: '2026-09-17T15:30:00Z',
      creator: andrea,
      createdBy: andrea,
      createdById: andrea.id,
      cycleId: '',
      rank: `a${String(order).padStart(3, '0')}`,
      sortOrder: order * 1000,
      goal: null,
      dependsOn: [],
      blocks: [],
      parentId: null,
      stage: null,
      statusId: null,
      childProgress: { total: 0, done: 0 },
      ...rest,
   };
}

export const persistHealth = task(42, 'Persist project health and updates', {
   statusId: 'in-progress',
   priorityId: 'high',
   assignee: agentUser(backendAgent),
   labels: [backendLabel],
   project: healthProject,
   dueDate: '2026-09-25T12:00:00.000Z',
   activeRunId: 'run-42-2',
   description:
      'The health chip has only ever lived in the browser. Add a column, a migration and an endpoint so it survives a reload.',
   goal: { id: 'goal-1', title: 'Projects report their own health' },
   createdAt: '2026-09-08T10:15:00Z',
   childProgress: { total: 3, done: 1 },
});

export const approvalsInbox = task(43, 'Move approvals and proposals into the inbox', {
   statusId: 'in-review',
   priorityId: 'medium',
   assignee: agentUser(frontendAgent),
   labels: [frontendLabel],
   project: inboxProject,
   dueDate: '2026-09-20T12:00:00.000Z',
   createdAt: '2026-09-05T08:00:00Z',
});

export const sharedFilter = task(44, 'Share the list filter through the URL', {
   statusId: 'to-do',
   priorityId: 'urgent',
   assignee: andrea,
   labels: [frontendLabel, bugLabel],
   dueDate: '2026-09-19T12:00:00.000Z',
   createdAt: '2026-09-15T14:00:00Z',
});

export const transcriptEditor = task(45, 'Render run transcript steps in a code editor', {
   statusId: 'to-do',
   priorityId: 'low',
   assignee: agentUser(frontendAgent),
   activeRunId: 'run-45-1',
   labels: [frontendLabel],
   createdAt: '2026-09-16T11:00:00Z',
});

export const rotateKey = task(46, 'Rotate the integration encryption key', {
   statusId: 'blocked',
   priorityId: 'urgent',
   assignee: maya,
   labels: [securityLabel, backendLabel],
   dependsOn: [
      { id: 'issue-42', identifier: 'BERR-42', title: persistHealth.title, status: 'inProgress' },
   ],
   createdAt: '2026-09-02T09:00:00Z',
});

export const healthTests = task(47, 'Cover health updates with DB-backed tests', {
   statusId: 'backlog',
   priorityId: 'no-priority',
   project: healthProject,
   parentId: 'issue-42',
   stage: 1,
   createdAt: '2026-09-17T09:00:00Z',
});

export const tightenSurfaces = task(48, 'Tighten task, review and display surfaces', {
   statusId: 'done',
   priorityId: 'medium',
   assignee: tomas,
   labels: [frontendLabel],
   createdAt: '2026-08-28T09:00:00Z',
   updatedAt: '2026-09-12T16:00:00Z',
});

export const dropOpenRouter = task(49, 'Drop the OpenRouter fallback', {
   statusId: 'cancelled',
   priorityId: 'low',
   createdAt: '2026-08-20T09:00:00Z',
});

export const storyIssues: Issue[] = [
   persistHealth,
   approvalsInbox,
   sharedFilter,
   transcriptEditor,
   rotateKey,
   healthTests,
   tightenSurfaces,
   dropOpenRouter,
];

export const dependencyRef = (issue: Issue, apiStatus: string): IssueDependencyRef => ({
   id: issue.id,
   identifier: issue.identifier,
   title: issue.title,
   status: apiStatus,
});

/* ---------------------------------- Runs --------------------------------- */

function run(
   id: string,
   issue: Issue,
   agentId: string,
   overrides: Partial<RunRecord> = {}
): RunRecord {
   return {
      id,
      issueId: issue.id,
      agentId,
      status: 'succeeded',
      sequence: 1,
      summary: null,
      usage: {
         inputTokens: 18_400,
         outputTokens: 2_150,
         totalTokens: 20_550,
         costMicros: 41_300,
         currency: 'USD',
      },
      failure: null,
      source: 'assignment',
      requestedBy: { type: 'user', id: andrea.id },
      createdAt: '2026-09-18T11:40:00Z',
      startedAt: '2026-09-18T11:40:05Z',
      completedAt: null,
      ...overrides,
   };
}

export const runningRun = run('run-42-2', persistHealth, backendAgent.id, {
   status: 'running',
   sequence: 2,
   createdAt: '2026-09-18T11:52:00Z',
   startedAt: '2026-09-18T11:52:04Z',
});

export const failedRun = run('run-42-1', persistHealth, backendAgent.id, {
   status: 'failed',
   createdAt: '2026-09-18T10:00:00Z',
   startedAt: '2026-09-18T10:00:03Z',
   completedAt: '2026-09-18T10:06:40Z',
   failure: {
      code: 'MIGRATION_FAILED',
      message: 'Migration 061 collided with an applied checksum.',
      retryable: true,
   },
});

export const queuedRun = run('run-45-1', transcriptEditor, frontendAgent.id, {
   status: 'queued',
   startedAt: null,
   createdAt: '2026-09-18T11:58:00Z',
});

export const deliveredRun = run('run-43-1', approvalsInbox, frontendAgent.id, {
   status: 'succeeded',
   summary: 'Approvals and proposals now render in the inbox; the old page redirects.',
   createdAt: '2026-09-18T08:00:00Z',
   startedAt: '2026-09-18T08:00:02Z',
   completedAt: '2026-09-18T08:21:30Z',
});

export const storyRuns: RunRecord[] = [runningRun, failedRun, queuedRun, deliveredRun];

/**
 * `GET /api/v1/runs/{id}/events` as a finished SSE body: the run started and
 * called `toolCalls` tools. The stream then ends, as a dropped one would.
 */
export function runEventsHandler(toolCalls: number) {
   return http.get('*/api/v1/runs/:runId/events', ({ params }) => {
      const runId = String(params.runId);
      const frame = (sequence: number, type: string, payload: unknown) =>
         `event: ${type}\ndata: ${JSON.stringify({
            id: `${runId}-${sequence}`,
            type,
            occurredAt: '2026-09-18T11:55:00Z',
            runId,
            sequence,
            payload,
         })}\n\n`;
      const frames = [frame(1, 'run.started', {})];
      for (let index = 0; index < toolCalls; index += 1) {
         frames.push(frame(index + 2, 'run.tool.started', { name: 'read_file' }));
      }
      return new HttpResponse(frames.join(''), {
         headers: { 'content-type': 'text/event-stream' },
      });
   });
}

/* -------------------------------- Comments ------------------------------- */

export function comment(
   id: string,
   body: string,
   author: User | Agent,
   overrides: Partial<ApiComment> = {}
): ApiComment {
   const isAgent = 'capabilities' in author;
   return {
      id,
      issueId: persistHealth.id,
      body,
      author: {
         type: isAgent ? 'agent' : 'user',
         id: author.id,
         name: author.name,
         avatarUrl: null,
      },
      parentId: null,
      revision: 1,
      resolvedAt: null,
      resolvedBy: null,
      createdAt: '2026-09-18T09:00:00Z',
      updatedAt: '2026-09-18T09:00:00Z',
      ...overrides,
   };
}

/* ------------------------------ Attachments ------------------------------ */

export function attachment(
   id: string,
   fileName: string,
   contentType: string,
   sizeBytes: number,
   uploader: User | Agent | null = andrea
): ApiAttachment {
   return {
      id,
      issueId: persistHealth.id,
      commentId: null,
      fileName,
      contentType,
      sizeBytes,
      uploader: uploader
         ? {
              type: 'capabilities' in uploader ? 'agent' : 'user',
              id: uploader.id,
              name: uploader.name,
              avatarUrl: null,
           }
         : null,
      downloadUrl: `/api/v1/attachments/${id}/download`,
      createdAt: '2026-09-17T16:00:00Z',
   };
}

/** A screenshot-shaped picture, so an image preview has something to show. */
export const screenshotSvg = (label: string) =>
   `<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540"><rect width="960" height="540" fill="#1f2433"/><rect x="40" y="40" width="880" height="56" rx="8" fill="#2d3448"/><rect x="40" y="120" width="560" height="24" rx="6" fill="#3e63dd"/><rect x="40" y="160" width="720" height="18" rx="6" fill="#39415a"/><rect x="40" y="190" width="640" height="18" rx="6" fill="#39415a"/><text x="480" y="420" fill="#c9d1e6" font-family="sans-serif" font-size="36" text-anchor="middle">${label}</text></svg>`;

/** Bytes behind every attachment's `downloadUrl`. */
export const attachmentDownloadHandler = http.get(
   '*/api/v1/attachments/:id/download',
   ({ params }) =>
      new HttpResponse(screenshotSvg(String(params.id)), {
         headers: { 'content-type': 'image/svg+xml' },
      })
);

/* ------------------------------- API shapes ------------------------------ */

const API_STATUS: Record<string, string> = {
   'backlog': 'backlog',
   'to-do': 'todo',
   'in-progress': 'inProgress',
   'in-review': 'inReview',
   'done': 'done',
   'blocked': 'blocked',
   'cancelled': 'cancelled',
};
const API_PRIORITY: Record<string, string> = {
   'no-priority': 'none',
   'urgent': 'urgent',
   'high': 'high',
   'medium': 'medium',
   'low': 'low',
};

/** A task as `GET /api/v1/issues/{ref}` returns it. */
export function apiIssue(issue: Issue) {
   const actor = (user: User | null | undefined) =>
      user
         ? {
              type: user.role === 'Application' ? ('agent' as const) : ('user' as const),
              id: user.id,
              name: user.name,
              avatarUrl: null,
           }
         : null;
   return {
      id: issue.id,
      boardId: 'board-1',
      number: Number(issue.identifier.split('-')[1]),
      identifier: issue.identifier,
      title: issue.title,
      description: issue.description,
      status: API_STATUS[issue.status.id] ?? 'todo',
      priority: API_PRIORITY[issue.priority.id] ?? 'none',
      sortOrder: issue.sortOrder,
      dueDate: issue.dueDate ?? null,
      assignee: actor(issue.assignee),
      activeRunId: issue.activeRunId ?? null,
      project: issue.project ? { id: issue.project.id, name: issue.project.name } : null,
      createdBy: actor(issue.createdBy),
      createdAt: issue.createdAt,
      updatedAt: issue.updatedAt ?? issue.createdAt,
      goal: issue.goal ?? null,
      dependsOn: issue.dependsOn ?? [],
      blocks: issue.blocks ?? [],
      parentId: issue.parentId ?? null,
      stage: issue.stage ?? null,
      statusId: issue.statusId ?? null,
      childProgress: issue.childProgress ?? null,
   };
}

export const emptyPage = { hasNextPage: false, endCursor: null };

/** The task reads and writes nearly every issues story ends up making. */
export const issueApiHandlers = [
   http.get('*/api/v1/issues/:ref', ({ params }) => {
      const found = storyIssues.find(
         (entry) => entry.identifier === params.ref || entry.id === params.ref
      );
      return found
         ? HttpResponse.json(apiIssue(found))
         : HttpResponse.json(
              { error: { code: 'ISSUE_NOT_FOUND', message: 'Not found', details: null } },
              { status: 404 }
           );
   }),
   http.patch('*/api/v1/issues/:ref', () => new HttpResponse(null, { status: 204 })),
   http.delete('*/api/v1/issues/:ref', () => new HttpResponse(null, { status: 204 })),
];

/**
 * Everything the task page asks for besides the task, answered with a quiet,
 * realistic default: a couple of labels and followers, a finished run, a
 * comment thread, no custom fields. Stories override single routes on top.
 */
export const issueDetailHandlers = [
   http.get('*/api/v1/issues/:ref/labels', () =>
      HttpResponse.json({
         nodes: [backendLabel].map((label) => ({ ...label, description: null, archivedAt: null })),
      })
   ),
   http.get('*/api/v1/issues/:ref/subscribers', () =>
      HttpResponse.json({
         nodes: [
            {
               userId: andrea.id,
               name: andrea.name,
               avatarUrl: null,
               reason: 'creator',
               subscribedAt: '2026-09-08T10:15:00Z',
            },
         ],
         subscribed: true,
      })
   ),
   http.get('*/api/v1/issues/:ref/reviews', () => HttpResponse.json({ reviews: [] })),
   http.get('*/api/v1/issues/:ref/attachments', () =>
      HttpResponse.json({
         nodes: [attachment('att-health-before', 'health-chip-before.png', 'image/png', 184_220)],
         pageInfo: emptyPage,
      })
   ),
   http.get('*/api/v1/issues/:ref/artifacts', () => HttpResponse.json({ artifacts: [] })),
   http.get('*/api/v1/issues/:ref/children', () =>
      HttpResponse.json({ nodes: [apiIssue(healthTests)], progress: { total: 1, done: 0 } })
   ),
   http.get('*/api/v1/issues/:ref/dependencies', () =>
      HttpResponse.json({ dependsOn: [], blocks: [dependencyRef(rotateKey, 'blocked')] })
   ),
   http.get('*/api/v1/issues/:ref/comments', () =>
      HttpResponse.json({
         nodes: [
            comment(
               'comment-1',
               'Migration 061 is applied on the test database; the endpoint change is next.',
               backendAgent,
               { createdAt: '2026-09-18T10:06:30Z', updatedAt: '2026-09-18T10:06:30Z' }
            ),
            comment('comment-2', 'Thanks. Keep the review gate on the health change.', andrea, {
               createdAt: '2026-09-18T10:20:00Z',
               updatedAt: '2026-09-18T10:20:00Z',
            }),
         ],
         pageInfo: emptyPage,
      })
   ),
   http.get('*/api/v1/issues/:ref/activity', () =>
      HttpResponse.json({
         nodes: [
            {
               id: 'act-1',
               type: 'issue.created',
               occurredAt: '2026-09-08T10:15:00Z',
               actor: { type: 'user', id: andrea.id, name: andrea.name, avatarUrl: null },
               changedFields: [],
               previousStatus: null,
               status: 'todo',
               commentId: null,
               details: {},
            },
         ],
         pageInfo: emptyPage,
      })
   ),
   http.get('*/api/v1/issues/:ref/runs', () =>
      HttpResponse.json({ nodes: [runningRun, failedRun], pageInfo: emptyPage })
   ),
   http.get('*/api/v1/issues/:ref/properties', () => HttpResponse.json({ nodes: [] })),
   http.get('*/api/v1/:target/:id/reactions', () => HttpResponse.json({ nodes: [] })),
   http.get('*/api/v1/catalogs/:workspaceId/issue-properties', () =>
      HttpResponse.json({ nodes: [] })
   ),
   http.get('*/api/v1/catalogs/:workspaceId/issue-statuses', () =>
      HttpResponse.json({ nodes: [] })
   ),
   http.get('*/api/v1/catalogs/:workspaceId/quick-actions', () => HttpResponse.json({ nodes: [] })),
   http.get('*/api/v1/github/:workspaceId/issues/:ref/pull-requests', () =>
      HttpResponse.json({ visible: false, pullRequests: [] })
   ),
   http.get('*/api/v1/workspaces/:workspaceId/members', () =>
      HttpResponse.json({ nodes: [], pageInfo: emptyPage })
   ),
   http.get('*/api/v1/usage/:workspaceId/issues/:issueId', () =>
      HttpResponse.json({
         currency: 'USD',
         totals: {
            key: 'total',
            events: 31,
            unpricedEvents: 0,
            inputTokens: 40_200,
            outputTokens: 5_900,
            cacheReadTokens: 96_000,
            cacheWriteTokens: 11_300,
            costMicros: 118_700,
         },
         byRun: [],
         byModel: [],
      })
   ),
   http.get(
      '*/api/v1/runs/:runId/events',
      () => new HttpResponse('', { headers: { 'content-type': 'text/event-stream' } })
   ),
   attachmentDownloadHandler,
];

/* --------------------------------- Seeding -------------------------------- */

export const storyWorkspace = { id: 'ws-1', name: 'Berry', slug: 'berry', role: 'admin' };

/**
 * Fill the stores the way a hydrated workspace has them, and reset the
 * momentary state. `withSession` also signs Andrea in to workspace ws-1,
 * which turns on the components that read the workspace id to fetch.
 */
export function seedIssuesWorkspace({
   issues = storyIssues,
   runs = storyRuns,
   layout = 'list',
   withSession = false,
}: {
   issues?: Issue[];
   runs?: RunRecord[];
   layout?: ViewType;
   withSession?: boolean;
} = {}): void {
   useIssuesStore.getState().hydrateIssues(issues);
   useIssuesStore.setState({ loadState: 'ready', loadError: null });
   useMembersStore.setState({ members: storyMembers });
   useAgentsStore.setState({ agents: storyAgents, archived: null, error: null });
   useLabelsStore.setState({ labels: storyLabels });
   useProjectsStore.setState({ projects: storyProjects });
   useRunsStore.setState({ runs, error: null });
   usePinsStore.setState({ pins: [], loaded: true });
   useIssueSelectionStore.setState({ selected: [], anchor: null });
   useRightPanelStore.setState({ openPanel: null });
   useViewStore.setState({ viewType: layout });
   useDisplaySettingsStore.getState().resetDisplaySettings();
   useSessionStore.setState(
      withSession
         ? {
              status: 'ready',
              user: andrea,
              workspace: storyWorkspace,
              workspaces: [storyWorkspace],
           }
         : { status: 'ready', user: andrea, workspace: null, workspaces: [] }
   );
}
