/**
 * Shared story data for components/common/projects, goals and cycles.
 *
 * Modelled on what the app holds after `/api/v1/projects` and friends have
 * been mapped by lib/*.ts: a workspace of people plus an agent, a handful of
 * projects spread over every project status and health, and tasks linked to
 * them so percentages, counts and breakdowns have something to show.
 */
import { projectCreateStatusOptions } from '@/components/common/projects/create-project/project-status-options';
import type { Issue } from '@/data/issues';
import type { LabelInterface } from '@/data/labels';
import { priorities, type Priority } from '@/data/priorities';
import type { ProjectDetail, ProjectUpdate } from '@/data/project-details';
import { health, type Health, type Project } from '@/data/projects';
import { status as issueStatuses, type Status } from '@/data/status';
import type { User } from '@/data/users';
import type { Goal } from '@/lib/goals';
import { useApprovalsStore } from '@/store/approvals-store';
import { useCreateProjectStore } from '@/store/create-project-store';
import { useGoalsStore } from '@/store/goals-store';
import { useIssuesStore } from '@/store/issues-store';
import { useMembersStore } from '@/store/members-store';
import { usePinsStore } from '@/store/pins-store';
import { useProjectUpdatesStore } from '@/store/project-updates-store';
import { useProjectsDisplayStore } from '@/store/projects-display-store';
import { useProjectsStore } from '@/store/projects-store';
import { useRightPanelStore } from '@/store/right-panel-store';
import { useSessionStore } from '@/store/session-store';
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
      teamIds: ['ws-1'],
      timezone: 'Europe/Rome',
   };
}

export const andrea = person('user-1', 'Andrea Lunelio', 'andrea@berry.dev', 'online');
export const maya = person('user-2', 'Maya Chen', 'maya@berry.dev', 'away');
export const tomas = person('user-3', 'Tomás Ferreira', 'tomas@berry.dev', 'offline');
export const frontendAgent: User = {
   ...person('agent-1', 'Frontend Engineer', '', 'online'),
   role: 'Application',
};

export const storyMembers: User[] = [andrea, maya, tomas, frontendAgent];

/* ------------------------------ Vocabularies ----------------------------- */

const priorityById = (id: string): Priority => priorities.find((entry) => entry.id === id)!;
const healthById = (id: Health['id']): Health => health.find((entry) => entry.id === id)!;
/** Project workflow states, as the create dialog and the status selectors offer them. */
export const projectStatus = (id: string): Status =>
   projectCreateStatusOptions.find((option) => option.status.id === id)!.status;
const issueStatus = (id: string): Status => issueStatuses.find((entry) => entry.id === id)!;

export const storyLabels: LabelInterface[] = [
   { id: 'label-frontend', name: 'Frontend', color: '#5e6ad2' },
   { id: 'label-infra', name: 'Infra', color: '#26b5ce' },
   { id: 'label-agents', name: 'Agents', color: '#f2994a' },
];

/* -------------------------------- Projects ------------------------------- */

export function makeProject(overrides: Partial<Project> & Pick<Project, 'id' | 'name'>): Project {
   return {
      status: projectStatus('in-progress'),
      icon: FolderKanban,
      percentComplete: 0,
      startDate: '2026-08-03',
      targetDate: '2026-10-30',
      lead: andrea,
      priority: priorityById('high'),
      health: healthById('on-track'),
      teamId: 'ws-1',
      createdById: andrea.id,
      createdAt: '2026-08-01T09:12:00Z',
      updatedAt: '2026-09-17T16:40:00Z',
      ...overrides,
   };
}

export const projectHealth = makeProject({
   id: 'proj-health',
   name: 'Persist project health',
   percentComplete: 60,
   description:
      'Move the health chip off the browser and into Postgres, with an update history the Activity feed can read.',
   githubRepo: 'berry-dev/berry',
});

export const projectRunner = makeProject({
   id: 'proj-runner',
   name: 'AgentCore runtime rollout',
   status: projectStatus('in-progress'),
   priority: priorityById('urgent'),
   health: healthById('at-risk'),
   lead: maya,
   startDate: '2026-07-14',
   targetDate: '2026-09-30',
   percentComplete: 35,
   createdById: maya.id,
});

export const projectInbox = makeProject({
   id: 'proj-inbox',
   name: 'Inbox for approvals and proposals',
   status: projectStatus('to-do'),
   priority: priorityById('medium'),
   health: healthById('no-update'),
   lead: tomas,
   startDate: '2026-10-05',
   targetDate: '2026-11-20',
   createdById: tomas.id,
});

export const projectBilling = makeProject({
   id: 'proj-billing',
   name: 'Usage-based billing',
   status: projectStatus('paused'),
   priority: priorityById('low'),
   health: healthById('off-track'),
   lead: maya,
   startDate: '2026-06-01',
   targetDate: '2026-08-28',
   percentComplete: 20,
});

export const projectOnboarding = makeProject({
   id: 'proj-onboarding',
   name: 'Workspace onboarding',
   status: projectStatus('done'),
   priority: priorityById('no-priority'),
   health: healthById('on-track'),
   startDate: '2026-05-04',
   targetDate: '2026-07-31',
   percentComplete: 100,
});

export const storyProjects: Project[] = [
   projectHealth,
   projectRunner,
   projectInbox,
   projectBilling,
   projectOnboarding,
];

/* --------------------------------- Tasks --------------------------------- */

let rank = 0;
function task(
   identifier: string,
   title: string,
   statusId: string,
   project: Project | undefined,
   assignee: User | null,
   extra: Partial<Issue> = {}
): Issue {
   rank += 1;
   return {
      id: `issue-${identifier.toLowerCase()}`,
      identifier,
      title,
      description: '',
      status: issueStatus(statusId),
      assignee,
      priority: priorityById('medium'),
      labels: [],
      createdAt: '2026-09-01T10:00:00Z',
      updatedAt: '2026-09-17T10:00:00Z',
      cycleId: '',
      project,
      rank: `0|hzzzz${rank}:`,
      sortOrder: rank,
      ...extra,
   };
}

export const storyIssues: Issue[] = [
   task('BERR-41', 'Add health column and migration', 'done', projectHealth, andrea, {
      labels: [storyLabels[1]!],
   }),
   task('BERR-42', 'Record project updates with health', 'done', projectHealth, frontendAgent, {
      labels: [storyLabels[1]!],
   }),
   task('BERR-43', 'Render updates in the Activity feed', 'done', projectHealth, frontendAgent, {
      labels: [storyLabels[0]!],
   }),
   task('BERR-44', 'Health popover writes through the API', 'in-progress', projectHealth, maya, {
      labels: [storyLabels[0]!],
      priority: priorityById('high'),
   }),
   task('BERR-45', 'Backfill health for existing projects', 'to-do', projectHealth, null),
   task('BERR-51', 'Publish runtime image', 'done', projectRunner, maya),
   task('BERR-52', 'Lease renewal under load', 'in-review', projectRunner, frontendAgent, {
      priority: priorityById('urgent'),
   }),
   task('BERR-53', 'Cold restore from transcript', 'blocked', projectRunner, tomas),
   task('BERR-61', 'Usage meter events', 'in-progress', projectBilling, maya),
];

export const issuesFor = (projectId: string) =>
   storyIssues.filter((issue) => issue.project?.id === projectId);

/* ----------------------------- Project detail ---------------------------- */

export const storyDetail = (projectId: string): ProjectDetail => ({
   projectId,
   description: [],
   resources: [],
   updates: [],
   activity: [
      { id: 'act-1', user: maya, date: '2026-09-16', text: 'moved health to on track' },
      { id: 'act-2', user: andrea, date: '2026-09-02', text: 'linked berry-dev/berry' },
   ],
});

export const storyUpdates: ProjectUpdate[] = [
   {
      id: 'upd-2',
      author: maya,
      date: '2026-09-16',
      health: 'on-track',
      blocks: [
         {
            type: 'paragraph',
            text: 'Updates API is merged. The popover now writes through; backfill is next.',
         },
      ],
   },
   {
      id: 'upd-1',
      author: andrea,
      date: '2026-09-02',
      health: 'at-risk',
      blocks: [{ type: 'paragraph', text: 'Migration 041 needed a rewrite after review.' }],
   },
];

/* --------------------------------- Wire ---------------------------------- */

const API_STATUS: Record<string, string> = {
   'to-do': 'planned',
   'in-progress': 'active',
   'paused': 'paused',
   'done': 'completed',
   'cancelled': 'cancelled',
};
const API_HEALTH: Record<Health['id'], string> = {
   'no-update': 'noUpdate',
   'on-track': 'onTrack',
   'at-risk': 'atRisk',
   'off-track': 'offTrack',
};

/** A project as `GET/PATCH /api/v1/projects/{id}` returns it (lib/projects.ts projectSchema). */
export function apiProject(project: Project) {
   return {
      id: project.id,
      workspaceId: 'ws-1',
      name: project.name,
      description: project.description ?? null,
      status: API_STATUS[project.status.id] ?? 'planned',
      priority: project.priority.id === 'no-priority' ? 'none' : project.priority.id,
      health: API_HEALTH[project.health.id],
      startDate: project.startDate,
      targetDate: project.targetDate ?? null,
      githubRepo: project.githubRepo ?? null,
      lead: { type: 'user', id: project.lead.id },
      createdBy: project.createdById ? { type: 'user', id: project.createdById } : null,
      createdAt: project.createdAt,
      updatedAt: project.updatedAt,
   };
}

/**
 * `PATCH /api/v1/projects/{id}`: echoes the patch over the project as the
 * store holds it, which is what the server answers with.
 */
export async function echoProjectPatch({
   params,
   request,
}: {
   params: Record<string, string | readonly string[] | undefined>;
   request: Request;
}) {
   const patch = (await request.json()) as Record<string, unknown>;
   const project = useProjectsStore.getState().getProjectById(String(params.id)) ?? projectHealth;
   return HttpResponse.json({ ...apiProject(project), ...patch });
}

export const projectPatchHandler = http.patch('*/api/v1/projects/:id', echoProjectPatch);

/** `GET /api/v1/projects/{id}/updates` (lib/project-updates.ts). */
export const apiProjectUpdates = {
   nodes: [
      {
         id: 'upd-2',
         projectId: projectHealth.id,
         body: 'Updates API is merged. The popover now writes through; backfill is next.',
         health: 'onTrack',
         author: { type: 'user', id: maya.id, name: maya.name, avatarUrl: null },
         createdAt: '2026-09-16T14:02:00Z',
         updatedAt: '2026-09-16T14:02:00Z',
      },
      {
         id: 'upd-1',
         projectId: projectHealth.id,
         body: 'Migration 041 needed a rewrite after review.\n\nBackfill waits on it.',
         health: 'atRisk',
         author: { type: 'user', id: andrea.id, name: andrea.name, avatarUrl: null },
         createdAt: '2026-09-02T09:30:00Z',
         updatedAt: '2026-09-02T09:30:00Z',
      },
   ],
   pageInfo: { hasNextPage: false, endCursor: null },
};

/** `GET /api/v1/integrations/github/repositories` (lib/projects.ts). */
export const apiRepositories = {
   repositories: [
      {
         id: 101,
         fullName: 'berry-dev/berry',
         name: 'berry',
         private: true,
         defaultBranch: 'main',
      },
      {
         id: 102,
         fullName: 'berry-dev/plugin-sdk',
         name: 'plugin-sdk',
         private: false,
         defaultBranch: 'main',
      },
      {
         id: 103,
         fullName: 'berry-dev/runtime-image',
         name: 'runtime-image',
         private: true,
         defaultBranch: 'main',
      },
   ],
   access: {
      canPush: true,
      selectedOnly: false,
      installed: true,
      source: 'installation' as const,
   },
};

/* --------------------------------- Goals --------------------------------- */

export function makeGoal(overrides: Partial<Goal> & Pick<Goal, 'id' | 'title'>): Goal {
   return {
      workspaceId: 'ws-1',
      projectId: projectHealth.id,
      description: null,
      status: 'active',
      createdBy: { type: 'user', id: andrea.id, name: andrea.name, avatarUrl: null },
      createdAt: '2026-09-01T09:00:00Z',
      updatedAt: '2026-09-18T09:00:00Z',
      startedAt: '2026-09-02T11:20:00Z',
      completedAt: null,
      progress: { issuesTotal: 5, issuesDone: 3, issuesCancelled: 0, approvalsPending: 1 },
      ...overrides,
   };
}

export const goalActive = makeGoal({
   id: 'goal-1',
   title: 'Project health survives a reload',
   description:
      'Every health change is stored with an update, so the chip reads the same for everyone.',
});

export const goalBlocked = makeGoal({
   id: 'goal-2',
   title: 'Runtime restores cold sessions',
   projectId: projectRunner.id,
   status: 'blocked',
   updatedAt: '2026-09-16T12:00:00Z',
   progress: { issuesTotal: 3, issuesDone: 1, issuesCancelled: 0, approvalsPending: 0 },
});

export const goalPlanned = makeGoal({
   id: 'goal-3',
   title: 'Approvals land in one inbox',
   projectId: null,
   description: 'Proposals and approvals move out of the sidebar into the inbox.',
   status: 'planned',
   startedAt: null,
   updatedAt: '2026-09-10T08:00:00Z',
   progress: { issuesTotal: 4, issuesDone: 0, issuesCancelled: 0, approvalsPending: 0 },
});

export const goalCompleted = makeGoal({
   id: 'goal-4',
   title: 'New workspaces get an organization',
   projectId: projectOnboarding.id,
   status: 'completed',
   completedAt: '2026-08-01T17:00:00Z',
   updatedAt: '2026-08-01T17:00:00Z',
   progress: { issuesTotal: 6, issuesDone: 5, issuesCancelled: 1, approvalsPending: 0 },
});

export const storyGoals: Goal[] = [goalActive, goalBlocked, goalPlanned, goalCompleted];

/* --------------------------------- Seeds --------------------------------- */

/**
 * Put every store the project surfaces read into the same realistic state.
 * Stores are module singletons shared across stories, so each story file
 * calls this from its meta `beforeEach` rather than relying on leftovers.
 */
export function seedProjectStores({
   projects = storyProjects,
   issues = storyIssues,
   sessionReady = false,
}: { projects?: Project[]; issues?: Issue[]; sessionReady?: boolean } = {}) {
   useMembersStore.setState({ members: storyMembers });
   useProjectsStore.setState({ projects });
   useIssuesStore.getState().hydrateIssues(issues);
   useProjectUpdatesStore.setState({ updatesByProject: {} });
   useCreateProjectStore.setState({ isOpen: false, defaultStatus: null });
   useRightPanelStore.setState({ openPanel: null });
   usePinsStore.setState({ pins: [], loaded: true });
   useProjectsDisplayStore.getState().resetDisplaySettings();
   useSessionStore.setState({
      status: sessionReady ? 'ready' : 'anonymous',
      user: andrea,
      workspace: { id: 'ws-1', name: 'Berry', slug: 'berry', role: 'admin' },
      workspaces: [{ id: 'ws-1', name: 'Berry', slug: 'berry', role: 'admin' }],
   });
}

export function seedGoalStores(goals: Goal[] = storyGoals) {
   useGoalsStore.setState({ goals, error: null, loaded: true });
   useApprovalsStore.setState({ approvals: [], loaded: true, error: null });
}
