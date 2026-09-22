/**
 * Story fixtures for saved views: the rows `/api/v1/views` returns, the UI
 * views they turn into, and a handful of tasks and projects for a view to
 * narrow down.
 */
import { Box, Globe } from 'lucide-react';
import { http, HttpResponse } from 'msw';
import type { Issue } from '@/data/issues';
import { priorities } from '@/data/priorities';
import { health, type Project } from '@/data/projects';
import { status } from '@/data/status';
import type { User } from '@/data/users';
import type { View } from '@/data/views';
import { toUiView, type SavedView } from '@/lib/views';

export const viewUser: User = {
   id: 'user-andrea',
   name: 'Andrea Lunelio',
   avatarUrl: '',
   email: 'andrea@example.com',
   status: 'online',
   role: 'Admin',
   joinedDate: '2026-01-04',
   teamIds: [],
   timezone: 'Europe/Rome',
};

export const viewSession = {
   status: 'ready' as const,
   user: viewUser,
   workspace: { id: 'ws-1', name: 'Berry', slug: 'berry', role: 'admin' },
   workspaces: [{ id: 'ws-1', name: 'Berry', slug: 'berry', role: 'admin' }],
   boardId: 'board-1',
   error: null,
};

function saved(
   id: string,
   name: string,
   query: Record<string, unknown>,
   extra: Partial<SavedView> = {}
): SavedView {
   return {
      id,
      workspaceId: 'ws-1',
      ownerId: viewUser.id,
      name,
      visibility: 'workspace',
      definitionVersion: 1,
      query,
      display: { layout: 'list', grouping: 'status', ordering: 'priority', direction: 'asc' },
      revision: 3,
      createdAt: '2026-08-12T09:00:00Z',
      updatedAt: '2026-09-15T14:00:00Z',
      ...extra,
   };
}

export const savedViews: SavedView[] = [
   saved(
      'view-review',
      'In review',
      { statuses: ['inReview'] },
      {
         display: { layout: 'list', icon: '👀' },
      }
   ),
   saved(
      'view-urgent',
      'Urgent and high',
      { priorities: ['urgent', 'high'] },
      {
         display: { layout: 'table', icon: '🔥' },
         createdAt: '2026-09-01T09:00:00Z',
      }
   ),
   saved(
      'view-unassigned',
      'Nobody on it',
      { unassigned: true },
      {
         visibility: 'private',
         display: { layout: 'list', icon: '🫥' },
         updatedAt: '2026-09-17T08:00:00Z',
      }
   ),
   saved(
      'view-agents',
      'Agent work in flight',
      { statuses: ['inProgress'], scope: 'agents' },
      {
         display: { layout: 'grid', icon: '🤖' },
      }
   ),
   saved(
      'view-projects',
      'Active projects',
      { resourceType: 'project' },
      {
         display: { icon: '📦' },
      }
   ),
];

export const uiViews: View[] = savedViews.map((entry) => toUiView(entry, viewUser, viewUser.id));

const byId = <T extends { id: string }>(list: T[], id: string): T =>
   list.find((entry) => entry.id === id) ?? list[0]!;

export const viewProjects: Project[] = [
   {
      id: 'project-berry',
      name: 'Berry core',
      status: byId(status, 'in-progress'),
      icon: Box,
      percentComplete: 42,
      startDate: '2026-08-01',
      targetDate: '2026-10-15',
      lead: viewUser,
      priority: byId(priorities, 'high'),
      health: byId(health, 'on-track'),
      teamId: 'team-core',
      createdAt: '2026-08-01T09:00:00Z',
      updatedAt: '2026-09-17T16:00:00Z',
   },
   {
      id: 'project-site',
      name: 'Marketing site',
      status: byId(status, 'to-do'),
      icon: Globe,
      percentComplete: 0,
      startDate: '2026-09-01',
      lead: viewUser,
      priority: byId(priorities, 'low'),
      health: byId(health, 'at-risk'),
      teamId: 'team-core',
      createdAt: '2026-09-01T09:00:00Z',
      updatedAt: '2026-09-12T10:00:00Z',
   },
];

function issue(
   n: number,
   title: string,
   statusId: string,
   priorityId: string,
   extra: Partial<Issue> = {}
): Issue {
   return {
      id: `issue-${n}`,
      identifier: `BERR-${n}`,
      title,
      description: '',
      status: byId(status, statusId),
      assignee: viewUser,
      priority: byId(priorities, priorityId),
      labels: [],
      createdAt: '2026-09-10T09:00:00Z',
      updatedAt: '2026-09-17T09:00:00Z',
      cycleId: '',
      rank: `0|h${n}:`,
      sortOrder: n,
      project: viewProjects[0],
      ...extra,
   };
}

export const viewIssues: Issue[] = [
   issue(101, 'Persist project health to the database', 'in-review', 'high'),
   issue(102, 'Move approvals and proposals into the inbox', 'in-review', 'medium'),
   issue(103, 'Render run transcript steps in a code editor', 'in-progress', 'urgent'),
   issue(104, 'Share the list filter across pages', 'to-do', 'high', { assignee: null }),
   issue(105, 'Write the Q3 changelog', 'backlog', 'low', { assignee: null, project: undefined }),
];

/** Views, preferences, the facet query and saves, as the server answers them. */
export const viewHandlers = [
   http.get('*/api/v1/views', () =>
      HttpResponse.json({ nodes: savedViews, pageInfo: { hasNextPage: false, endCursor: null } })
   ),
   http.get('*/api/v1/views/preferences', () =>
      HttpResponse.json({ activeViewId: null, preferences: { views: { order: [], hidden: [] } } })
   ),
   http.put('*/api/v1/views/preferences', () => new HttpResponse(null, { status: 204 })),
   http.post('*/api/v1/views/query', () =>
      HttpResponse.json({
         total: 2,
         groups: [{ key: 'inReview', count: 2, issueIds: ['issue-101'] }],
         facets: {
            status: { inReview: 2 },
            priority: { high: 1, medium: 1 },
            assignee: { [viewUser.id]: 2 },
         },
      })
   ),
   http.post('*/api/v1/views', async ({ request }) => {
      const body = (await request.json()) as { name: string; visibility: string };
      return HttpResponse.json(
         saved(
            'view-new',
            body.name,
            { filters: [], scope: 'all' },
            { visibility: body.visibility }
         ),
         { status: 201 }
      );
   }),
   http.patch('*/api/v1/views/:id', async ({ params, request }) => {
      const body = (await request.json()) as { name: string; visibility: string; revision: number };
      return HttpResponse.json(
         saved(
            String(params.id),
            body.name,
            { filters: [] },
            {
               visibility: body.visibility,
               revision: body.revision + 1,
            }
         )
      );
   }),
   http.delete('*/api/v1/views/:id', () => new HttpResponse(null, { status: 204 })),
   http.post('*/api/v1/pins', () =>
      HttpResponse.json({
         id: 'pin-1',
         targetType: 'view',
         targetId: 'view-review',
         position: 0,
         title: 'In review',
         identifier: null,
      })
   ),
];
