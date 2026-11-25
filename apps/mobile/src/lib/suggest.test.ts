import { describe, expect, test } from 'bun:test';

import { createBerryClient } from '@/api/client';
import { createIssue } from '@/api/issues';
import type { ApiProject } from '@/api/types';
import type { ActorView } from '@/model/mappers';

import { suggestFromDirectory } from './suggest';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const AGENTS: ActorView[] = [
  { id: 'agent-se-uuid', type: 'agent', name: 'Software Engineer', initials: 'SE', avatarUrl: null, roleKey: 'software-engineer' },
  { id: 'agent-qa-uuid', type: 'agent', name: 'QA Engineer', initials: 'QA', avatarUrl: null, roleKey: 'qa-engineer' },
  { id: 'agent-pd-uuid', type: 'agent', name: 'Product Designer', initials: 'PD', avatarUrl: null, roleKey: 'product-designer' },
];

const MEMBERS: ActorView[] = [
  { id: 'user-me-uuid', type: 'user', name: 'Eduardo', initials: 'ED', avatarUrl: null },
  { id: 'user-hm-uuid', type: 'user', name: 'Héctor Martínez', initials: 'HM', avatarUrl: null },
];

const PROJECTS: ApiProject[] = [
  { id: 'proj-mobile-uuid', workspaceId: 'ws-1', name: 'Mobile App', description: null, status: 'active', priority: 'high', health: 'onTrack', createdAt: '', updatedAt: '' },
  { id: 'proj-billing-uuid', workspaceId: 'ws-1', name: 'Billing', description: null, status: 'active', priority: 'medium', health: 'onTrack', createdAt: '', updatedAt: '' },
];

describe('suggestFromDirectory & createIssue', () => {
  test('matches real workspace agent by roleKey/name keywords instead of hardcoded fixture ids', () => {
    const res = suggestFromDirectory(
      'Fix urgent database migration bug in billing',
      { meId: 'user-me-uuid', agents: AGENTS, members: MEMBERS, projects: PROJECTS },
      {},
    );
    expect(res.canCreate).toBe(true);
    expect(res.assignee?.id).toBe('agent-se-uuid');
    expect(res.assignee?.type).toBe('agent');
    expect(res.priority).toBe('urgent');
    expect(res.project?.id).toBe('proj-billing-uuid');

    const qaRes = suggestFromDirectory(
      'Add regression tests to verify mobile app login',
      { meId: 'user-me-uuid', agents: AGENTS, members: MEMBERS, projects: PROJECTS },
      {},
    );
    expect(qaRes.assignee?.id).toBe('agent-qa-uuid');
    expect(qaRes.project?.id).toBe('proj-mobile-uuid');
  });

  test('falls back cleanly when workspace has no agents or projects', () => {
    const res = suggestFromDirectory(
      'Remind me to update docs',
      { meId: 'user-me-uuid', agents: [], members: MEMBERS, projects: [] },
      {},
    );
    expect(res.assignee?.id).toBe('user-me-uuid');
    expect(res.project).toBeNull();
    expect(res.isAgent).toBe(false);
  });

  test('createIssue sends POST /api/v1/issues with Idempotency-Key and valid initial status (backlog|todo)', async () => {
    let seenKey = '';
    let seenBody: Record<string, unknown> = {};
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (_input, init) => {
        seenKey = new Headers(init?.headers).get('idempotency-key') ?? '';
        seenBody = JSON.parse(String(init?.body ?? '{}')) as Record<string, unknown>;
        return jsonResponse(
          {
            id: 'issue-new',
            boardId: 'board-1',
            number: 99,
            identifier: 'LAR-99',
            title: 'Fix migration',
            description: 'Details',
            status: 'todo',
            priority: 'urgent',
            sortOrder: 0,
            startDate: null,
            dueDate: null,
            assignee: { type: 'agent', id: 'agent-se-uuid', name: 'Software Engineer', avatarUrl: null },
            activeRunId: null,
            project: { id: 'proj-billing-uuid', name: 'Billing' },
            createdBy: { type: 'user', id: 'user-me-uuid', name: 'Eduardo', avatarUrl: null },
            createdAt: '2026-11-25T12:00:00.000Z',
            updatedAt: '2026-11-25T12:00:00.000Z',
          },
          201,
        );
      },
    });

    const created = await createIssue(client, {
      boardId: 'board-1',
      title: 'Fix migration',
      description: 'Details',
      priority: 'urgent',
      status: 'todo',
      assignee: { type: 'agent', id: 'agent-se-uuid' },
      projectId: 'proj-billing-uuid',
    });

    expect(seenKey.length).toBeGreaterThanOrEqual(16);
    expect(seenBody.status).toBe('todo');
    expect(seenBody.boardId).toBe('board-1');
    expect(seenBody.assignee).toEqual({ type: 'agent', id: 'agent-se-uuid' });
    expect(seenBody.projectId).toBe('proj-billing-uuid');
    expect(created.identifier).toBe('LAR-99');
  });
});
