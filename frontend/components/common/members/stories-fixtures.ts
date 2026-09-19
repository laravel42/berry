import { http, HttpResponse } from 'msw';

import type { JoinLink } from '@/lib/join-links';
import type { TopAgent, WorkspaceInvitation, WorkspaceMemberRole } from '@/lib/workspaces';
import { useSessionStore } from '@/store/session-store';

/**
 * The Elian workspace's people as `/api/v1/workspaces/{id}/members` and its
 * neighbours return them. `user-1` is the signed-in account.
 */

export const WORKSPACE_ID = 'ws-1';

export const memberRoles: WorkspaceMemberRole[] = [
   {
      userId: 'user-1',
      role: 'owner',
      name: 'Andrea Lunelio',
      email: 'andrea@elian.dev',
      avatarUrl: null,
      joinedAt: '2026-01-12T09:14:00Z',
   },
   {
      userId: 'user-2',
      role: 'admin',
      name: 'Maya Okafor',
      email: 'maya@elian.dev',
      avatarUrl: null,
      joinedAt: '2026-02-03T16:40:00Z',
   },
   {
      userId: 'user-3',
      role: 'member',
      name: 'Tomás Reyes',
      email: 'tomas@elian.dev',
      avatarUrl: null,
      joinedAt: '2026-04-21T08:05:00Z',
   },
   {
      userId: 'user-4',
      role: 'viewer',
      name: 'Priya Nair',
      email: 'priya@contractor.io',
      avatarUrl: null,
      joinedAt: '2026-08-30T13:22:00Z',
   },
];

export const invitations: WorkspaceInvitation[] = [
   {
      id: 'inv-1',
      workspaceId: WORKSPACE_ID,
      workspaceName: 'Elian',
      email: 'lea@elian.dev',
      role: 'member',
      invitedBy: 'user-1',
      expiresAt: '2026-09-25T10:00:00Z',
      acceptedAt: null,
      revokedAt: null,
      createdAt: '2026-09-18T10:00:00Z',
   },
   {
      id: 'inv-2',
      workspaceId: WORKSPACE_ID,
      workspaceName: 'Elian',
      email: 'jonas@agency.example',
      role: 'viewer',
      invitedBy: 'user-2',
      expiresAt: '2026-09-10T10:00:00Z',
      acceptedAt: null,
      revokedAt: null,
      createdAt: '2026-09-03T10:00:00Z',
   },
];

export const joinLinks: JoinLink[] = [
   {
      id: 'jl-1',
      workspaceId: WORKSPACE_ID,
      role: 'member',
      expiresAt: '2026-09-25T00:00:00Z',
      maxUses: null,
      useCount: 2,
      revokedAt: null,
      createdAt: '2026-09-18T08:00:00Z',
      createdBy: 'user-1',
   },
];

export const topAgents: TopAgent[] = [
   { agentId: 'agent-eng', name: 'Engineer', runCount: 34 },
   { agentId: 'agent-rev', name: 'Code Reviewer', runCount: 12 },
   { agentId: 'agent-qa', name: 'QA Analyst', runCount: 3 },
];

/** Signs `userId` in with the given role in the Elian workspace. */
export function seedSession(userId = 'user-1', role = 'owner') {
   const member = memberRoles.find((entry) => entry.userId === userId) ?? memberRoles[0]!;
   const workspace = { id: WORKSPACE_ID, name: 'Elian', slug: 'elian', role };
   useSessionStore.setState({
      status: 'ready',
      workspace,
      workspaces: [workspace],
      boardId: 'board-1',
      user: {
         id: member.userId,
         name: member.name,
         avatarUrl: '',
         email: member.email,
         status: 'online',
         role: role === 'owner' || role === 'admin' ? 'Admin' : 'Member',
         joinedDate: member.joinedAt.slice(0, 10),
         teamIds: [],
         timezone: 'UTC',
      },
   });
}

const page = <T>(nodes: T[]) =>
   HttpResponse.json({ nodes, pageInfo: { hasNextPage: false, endCursor: null } });

export const membersHandlers = [
   http.get('*/api/v1/workspaces/:workspaceId/members', () => page(memberRoles)),
   http.get('*/api/v1/workspaces/:workspaceId/invitations', () => page(invitations)),
   http.get('*/api/v1/catalogs/:workspaceId/join-links', () => page(joinLinks)),
   http.get('*/api/v1/workspaces/:workspaceId/members/:userId/top-agents', () => page(topAgents)),
];
