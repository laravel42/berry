import { describe, expect, test } from 'bun:test';

import { ApiClientError, createBerryClient } from '@/api/client';

import {
  createToken,
  formatApiError,
  getProfile,
  getWorkspaceUsage,
  listCompletionLogs,
  listIntegrations,
  listMcpServers,
  listRuntimes,
  listTokens,
  listWorkspaceLabels,
  listWorkspaceMembers,
  revokeToken,
  updateProfile,
} from './settings';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('settings API wrappers', () => {
  test('tokens: list, create with Idempotency-Key, and revoke', async () => {
    const calls: { method: string; path: string; hasIdempotency: boolean; body?: string }[] = [];

    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        const headers = new Headers(init?.headers);
        calls.push({
          method: init?.method ?? 'GET',
          path: `${url.pathname}${url.search}`,
          hasIdempotency: headers.has('Idempotency-Key'),
          body: typeof init?.body === 'string' ? init.body : undefined,
        });

        if (url.pathname === '/api/v1/tokens' && (init?.method ?? 'GET') === 'GET') {
          return jsonResponse({
            nodes: [
              {
                id: 'tok-1',
                name: 'Android Pixel',
                prefix: 'berry_pat_ab',
                expiresAt: null,
                lastUsedAt: '2026-11-26T10:00:00.000Z',
                revokedAt: null,
                createdAt: '2026-11-20T10:00:00.000Z',
                scopes: null,
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          });
        }
        if (url.pathname === '/api/v1/tokens' && init?.method === 'POST') {
          return jsonResponse(
            {
              personalToken: {
                id: 'tok-2',
                name: 'CI Bot',
                prefix: 'berry_pat_cd',
                expiresAt: null,
                lastUsedAt: null,
                revokedAt: null,
                createdAt: '2026-11-26T12:00:00.000Z',
                scopes: null,
              },
              token: 'berry_pat_cd_secret_value',
            },
            201,
          );
        }
        if (url.pathname === '/api/v1/tokens/tok-2' && init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({}, 404);
      },
    });

    const tokens = await listTokens(client);
    expect(tokens).toHaveLength(1);
    expect(tokens[0]?.name).toBe('Android Pixel');

    const created = await createToken(client, '  CI Bot  ');
    expect(created.personalToken.id).toBe('tok-2');
    expect(created.token).toBe('berry_pat_cd_secret_value');

    await revokeToken(client, 'tok-2');

    expect(calls[0]).toEqual({
      method: 'GET',
      path: '/api/v1/tokens?first=100',
      hasIdempotency: false,
      body: undefined,
    });
    expect(calls[1]?.method).toBe('POST');
    expect(calls[1]?.path).toBe('/api/v1/tokens');
    expect(calls[1]?.hasIdempotency).toBe(true);
    expect(calls[1]?.body).toBe(JSON.stringify({ name: 'CI Bot' }));
    expect(calls[2]?.method).toBe('DELETE');
    expect(calls[2]?.path).toBe('/api/v1/tokens/tok-2');
  });

  test('profile: GET and PATCH /api/v1/me', async () => {
    const calls: { method: string; path: string; body?: string }[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push({
          method: init?.method ?? 'GET',
          path: url.pathname,
          body: typeof init?.body === 'string' ? init.body : undefined,
        });
        return jsonResponse({
          id: 'u-1',
          email: 'dev@berry.local',
          name: init?.method === 'PATCH' ? 'Updated Dev' : 'Dev',
          avatarUrl: null,
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-11-26T00:00:00.000Z',
        });
      },
    });

    const current = await getProfile(client);
    expect(current.name).toBe('Dev');

    const updated = await updateProfile(client, { name: '  Updated Dev ' });
    expect(updated.name).toBe('Updated Dev');
    expect(calls[1]).toEqual({
      method: 'PATCH',
      path: '/api/v1/me',
      body: JSON.stringify({ name: 'Updated Dev' }),
    });
  });

  test('workspace members, labels, integrations, MCP servers, usage, and logs', async () => {
    const seenPaths: string[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        seenPaths.push(`${url.pathname}${url.search}`);

        if (url.pathname === '/api/v1/workspaces/ws-1/members') {
          return jsonResponse({
            nodes: [
              {
                userId: 'u-1',
                workspaceId: 'ws-1',
                role: 'owner',
                email: 'owner@berry.local',
                name: 'Owner',
                avatarUrl: null,
                joinedAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          });
        }
        if (url.pathname === '/api/v1/catalogs/ws-1/issue-labels') {
          return jsonResponse({
            nodes: [
              {
                id: 'lbl-1',
                workspaceId: 'ws-1',
                name: 'bug',
                description: 'Broken behavior',
                color: '#E06A58',
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
                archivedAt: null,
                usageCount: 4,
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          });
        }
        if (url.pathname === '/api/v1/integrations/providers') {
          return jsonResponse({
            providers: [
              {
                id: 'github',
                name: 'GitHub',
                description: 'Source code and PRs',
                configured: true,
                connected: true,
                status: 'connected',
                statusDetail: null,
                accountName: 'berry-org',
              },
            ],
          });
        }
        if (url.pathname === '/api/v1/mcp-servers') {
          return jsonResponse({
            nodes: [
              {
                id: 'mcp-1',
                agentId: null,
                name: 'docs-mcp',
                url: 'https://mcp.example.com/sse',
                transport: 'streamable_http',
                headerNames: ['Authorization'],
                viaGateway: false,
                enabled: true,
                createdAt: '2026-01-01T00:00:00.000Z',
                updatedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          });
        }
        if (url.pathname === '/api/v1/usage/ws-1/summary') {
          return jsonResponse({
            currency: 'USD',
            days: 30,
            from: '2026-10-27T00:00:00.000Z',
            to: '2026-11-26T00:00:00.000Z',
            timezone: 'UTC',
            totals: {
              key: 'total',
              events: 12,
              unpricedEvents: 0,
              inputTokens: 15000,
              outputTokens: 3200,
              cacheReadTokens: 0,
              cacheWriteTokens: 0,
              costMicros: 125000,
            },
            runs: { runs: 8, failed: 1, runSeconds: 240 },
            byModel: [],
            byAgent: [],
          });
        }
        if (url.pathname === '/api/v1/logs/ws-1/prompts') {
          return jsonResponse({
            nodes: [
              {
                id: 'run-1',
                kind: 'completion',
                purpose: 'chat_title',
                agentName: 'Orchestrator',
                issueIdentifier: null,
                model: 'claude-sonnet',
                status: 'succeeded',
                structured: true,
                promptPreview: 'Summarize title',
                inputTokens: 400,
                outputTokens: 20,
                costMicros: 1500,
                durationMs: 850,
                failureCode: null,
                createdAt: '2026-11-26T09:00:00.000Z',
              },
            ],
            pageInfo: { hasNextPage: false, endCursor: null },
          });
        }
        return jsonResponse({}, 404);
      },
    });

    const [members, labels, integrations, mcps, usage, logs] = await Promise.all([
      listWorkspaceMembers(client, 'ws-1'),
      listWorkspaceLabels(client, 'ws-1'),
      listIntegrations(client, 'ws-1'),
      listMcpServers(client, 'ws-1'),
      getWorkspaceUsage(client, 'ws-1', 30),
      listCompletionLogs(client, 'ws-1', 20),
    ]);

    expect(members[0]?.email).toBe('owner@berry.local');
    expect(labels[0]?.usageCount).toBe(4);
    expect(integrations[0]?.connected).toBe(true);
    expect(mcps[0]?.name).toBe('docs-mcp');
    expect(usage.totals.costMicros).toBe(125000);
    expect(usage.runs.runs).toBe(8);
    expect(logs[0]?.purpose).toBe('chat_title');

    expect(seenPaths).toContain('/api/v1/workspaces/ws-1/members?first=100');
    expect(seenPaths).toContain('/api/v1/catalogs/ws-1/issue-labels?first=100');
    expect(seenPaths).toContain('/api/v1/integrations/providers');
    expect(seenPaths).toContain('/api/v1/mcp-servers?agentId=all');
    expect(seenPaths).toContain('/api/v1/usage/ws-1/summary?days=30');
    expect(seenPaths).toContain('/api/v1/logs/ws-1/prompts?first=20');
  });

  test('listRuntimes tolerates partial failure and returns available data', async () => {
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        if (url.pathname === '/api/v1/runtimes/connections') {
          return jsonResponse({
            nodes: [
              {
                id: 'conn-1',
                runtimeId: 'claude',
                status: 'connected',
                authMethod: 'claude_cli',
                accountId: null,
                accountName: 'Claude',
                connectedAt: '2026-11-26T00:00:00.000Z',
                disconnectedAt: null,
                lastCheckedAt: null,
                lastError: null,
              },
            ],
          });
        }
        return jsonResponse({ error: { code: 'FORBIDDEN', message: 'Denied', requestId: '', details: null } }, 403);
      },
    });

    const result = await listRuntimes(client, 'ws-1');
    expect(result.aiConnections).toHaveLength(1);
    expect(result.aiConnections[0]?.runtimeId).toBe('claude');
    expect(result.computeRuntimes).toEqual([]);
  });

  test('formatApiError handles 403, 404, and unknown errors', () => {
    const forbidden = new ApiClientError({ status: 403, code: 'FORBIDDEN', message: '' });
    expect(formatApiError(forbidden, 'Fallback')).toContain('permission');

    const notFound = new ApiClientError({ status: 404, code: 'NOT_FOUND', message: 'Missing endpoint' });
    expect(formatApiError(notFound, 'Fallback')).toBe('Missing endpoint');

    expect(formatApiError(null, 'Fallback')).toBe('Fallback');
  });
});
