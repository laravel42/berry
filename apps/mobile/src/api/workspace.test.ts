import { describe, expect, test } from 'bun:test';

import { createBerryClient } from '@/api/client';
import { createWorkspaceStore } from '@/store/workspace-store';

import { loadWorkspaceData } from './workspace';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('workspace API & store', () => {
  test('loadWorkspaceData calls POST /api/v1/workspaces/:id/select before GET /api/v1/agents', async () => {
    const order: string[] = [];
    let selectBody: unknown = 'UNSET';

    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        order.push(`${init?.method ?? 'GET'} ${url.pathname}`);
        if (url.pathname === '/api/v1/workspaces/ws-1/select') {
          selectBody = init?.body;
          return jsonResponse({
            id: 'ws-1',
            name: 'Laravel42',
            slug: 'laravel42',
            description: null,
            settings: { issuePrefix: 'LAR', defaultRole: 'member', allowMemberInvites: true },
            role: 'owner',
            createdAt: '2026-01-01T00:00:00.000Z',
            updatedAt: '2026-01-01T00:00:00.000Z',
          });
        }
        if (url.pathname === '/api/v1/boards') {
          return jsonResponse({
            nodes: [
              { id: 'b-1', workspaceId: 'ws-1', name: 'Main', slug: 'main', description: null, columns: [], createdAt: '', updatedAt: '' },
              { id: 'b-other', workspaceId: 'ws-2', name: 'Other', slug: 'other', description: null, columns: [], createdAt: '', updatedAt: '' },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          });
        }
        if (url.pathname === '/api/v1/workspaces/ws-1/members') {
          return jsonResponse({
            nodes: [{ userId: 'u-1', workspaceId: 'ws-1', role: 'owner', email: 'edo@laravel42.com', name: 'Eduardo', avatarUrl: null, joinedAt: '', updatedAt: '' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          });
        }
        if (url.pathname === '/api/v1/agents') {
          return jsonResponse({
            nodes: [{ id: 'a-1', name: 'Software Engineer', description: 'Codes', avatarUrl: null, status: 'available', roleKey: 'software-engineer', createdAt: '', updatedAt: '' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          });
        }
        if (url.pathname === '/api/v1/projects') {
          return jsonResponse({
            nodes: [{ id: 'p-1', workspaceId: 'ws-1', name: 'Mobile', description: null, status: 'active', priority: 'high', health: 'onTrack', createdAt: '', updatedAt: '' }],
            pageInfo: { hasNextPage: false, endCursor: null },
          });
        }
        return jsonResponse({}, 404);
      },
    });

    const data = await loadWorkspaceData(client, 'ws-1');
    expect(order[0]).toBe('POST /api/v1/workspaces/ws-1/select');
    expect(selectBody).toBeUndefined();
    expect(order.indexOf('GET /api/v1/agents')).toBeGreaterThanOrEqual(1);
    expect(data.boards.map((b) => b.id)).toEqual(['b-1']);
    expect(data.members).toHaveLength(1);
    expect(data.agents).toHaveLength(1);
    expect(data.projects).toHaveLength(1);
  });

  test('discards stale workspace load when user switches again mid-flight', async () => {
    let resolveSlowA!: () => void;
    const slowA = new Promise<void>((resolve) => {
      resolveSlowA = resolve;
    });

    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.pathname.includes('/ws-a/')) {
          await slowA;
        }
        if (url.pathname.endsWith('/select')) {
          const id = url.pathname.includes('ws-a') ? 'ws-a' : 'ws-b';
          return jsonResponse({
            id,
            name: id === 'ws-a' ? 'Workspace A' : 'Workspace B',
            slug: id,
            description: null,
            settings: { issuePrefix: id.toUpperCase(), defaultRole: 'member', allowMemberInvites: true },
            role: 'owner',
            createdAt: '',
            updatedAt: '',
          });
        }
        return jsonResponse({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } });
      },
    });

    const store = createWorkspaceStore();
    const loadA = store.getState().loadWorkspace(client, 'ws-a');
    const loadB = store.getState().loadWorkspace(client, 'ws-b');
    await loadB;
    resolveSlowA();
    await loadA;

    expect(store.getState().workspace?.id).toBe('ws-b');
    expect(store.getState().workspace?.name).toBe('Workspace B');
  });
});
