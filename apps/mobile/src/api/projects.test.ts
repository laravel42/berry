import { describe, expect, test } from 'bun:test';

import { createBerryClient } from '@/api/client';

import {
  createProjectUpdate,
  listProjectMilestones,
  listProjectUpdates,
  type ApiMilestone,
  type ApiProjectUpdate,
} from './projects';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeMilestone(overrides: Partial<ApiMilestone> = {}): ApiMilestone {
  return {
    id: 'm-1',
    workspaceId: 'ws-1',
    projectId: 'proj-1',
    title: 'Alpha',
    description: null,
    status: 'active',
    targetDate: '2026-12-15',
    sortOrder: 0,
    createdAt: '2026-11-20T10:00:00.000Z',
    updatedAt: '2026-11-25T10:00:00.000Z',
    progress: {
      issuesTotal: 4,
      issuesDone: 2,
      issuesCancelled: 0,
      issuesWorking: 1,
      approvalsPending: 0,
      percent: 50,
    },
    ...overrides,
  };
}

function makeUpdate(overrides: Partial<ApiProjectUpdate> = {}): ApiProjectUpdate {
  return {
    id: 'upd-1',
    projectId: 'proj-1',
    body: 'Shipped the API integration.',
    health: 'onTrack',
    author: { type: 'user', id: 'user-1', name: 'Eduardo', avatarUrl: null },
    createdAt: '2026-11-26T10:00:00.000Z',
    updatedAt: '2026-11-26T10:00:00.000Z',
    ...overrides,
  };
}

describe('projects API', () => {
  test('listProjectMilestones requests scoped milestones and sorts by sortOrder then id', async () => {
    let seenUrl = '';
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input) => {
        seenUrl = String(input);
        return jsonResponse({
          nodes: [
            makeMilestone({ id: 'm-b', sortOrder: 2, title: 'Beta' }),
            makeMilestone({ id: 'm-c', sortOrder: 1, title: 'Tie C' }),
            makeMilestone({ id: 'm-a', sortOrder: 1, title: 'Tie A' }),
            makeMilestone({ id: 'm-0', sortOrder: undefined, title: 'Default 0' }),
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        });
      },
    });

    const milestones = await listProjectMilestones(client, 'ws/1', 'proj/1');
    const parsed = new URL(seenUrl);
    expect(parsed.pathname).toBe('/api/v1/milestones');
    expect(parsed.searchParams.get('workspaceId')).toBe('ws/1');
    expect(parsed.searchParams.get('projectId')).toBe('proj/1');
    expect(parsed.searchParams.get('first')).toBe('100');
    expect(milestones.map((m) => m.id)).toEqual(['m-0', 'm-a', 'm-c', 'm-b']);
  });

  test('listProjectUpdates requests project updates with encoded projectId and first=50', async () => {
    let seenUrl = '';
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input) => {
        seenUrl = String(input);
        return jsonResponse({
          nodes: [makeUpdate({ id: 'upd-2' }), makeUpdate({ id: 'upd-1' })],
          pageInfo: { hasNextPage: false, endCursor: null },
        });
      },
    });

    const updates = await listProjectUpdates(client, 'proj/42');
    const parsed = new URL(seenUrl);
    expect(parsed.pathname).toBe('/api/v1/projects/proj%2F42/updates');
    expect(parsed.searchParams.get('first')).toBe('50');
    expect(updates.map((u) => u.id)).toEqual(['upd-2', 'upd-1']);
  });

  test('createProjectUpdate trims body, sends health and Idempotency-Key', async () => {
    let seenUrl = '';
    let seenMethod = '';
    let seenKey = '';
    let seenBody: unknown = null;
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        seenUrl = String(input);
        seenMethod = init?.method ?? 'GET';
        seenKey = new Headers(init?.headers).get('idempotency-key') ?? '';
        seenBody = JSON.parse(String(init?.body ?? '{}'));
        return jsonResponse(
          makeUpdate({ id: 'upd-new', health: 'atRisk', body: 'Blocked on staging deploy' }),
          201,
        );
      },
    });

    const created = await createProjectUpdate(client, 'proj-1', {
      health: 'atRisk',
      body: '  Blocked on staging deploy  ',
    });

    expect(new URL(seenUrl).pathname).toBe('/api/v1/projects/proj-1/updates');
    expect(seenMethod).toBe('POST');
    expect(seenKey.length).toBeGreaterThanOrEqual(16);
    expect(seenBody).toEqual({
      body: 'Blocked on staging deploy',
      health: 'atRisk',
    });
    expect(created.id).toBe('upd-new');
    expect(created.health).toBe('atRisk');
  });
});
