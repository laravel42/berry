import { describe, expect, test } from 'bun:test';

import { ApiClientError, createBerryClient } from '@/api/client';

import {
  addChannel,
  archiveIssueProperty,
  archiveQuickAction,
  archiveSkillLabel,
  CHANNEL_TYPES,
  createIssueProperty,
  createSkillLabel,
  createToken,
  describeDevice,
  formatApiError,
  getPlatformNotifications,
  getProfile,
  getTierModels,
  getUserSettings,
  getWorkspaceUsage,
  listChannels,
  listCompletionLogs,
  listIntegrations,
  listIssueProperties,
  listMcpServers,
  listQuickActions,
  listRuntimes,
  listSessions,
  listSkillLabels,
  listTokens,
  listWorkspaceLabels,
  listWorkspaceMembers,
  MAX_ACTIVE_PROPERTIES,
  NOTIFICATION_KEYS,
  PROPERTY_KINDS,
  removeChannel,
  restoreIssueProperty,
  restoreQuickAction,
  revokeSession,
  revokeToken,
  TIER_KEYS,
  updatePlatformNotification,
  updateProfile,
  updateUserSettings,
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

  test('user settings: GET and PATCH /api/v1/me/settings', async () => {
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
        if (init?.method === 'PATCH') {
          return jsonResponse({
            theme: 'dark',
            timezone: 'America/Mexico_City',
            reducedMotion: true,
            locale: 'es',
          });
        }
        return jsonResponse({
          theme: 'system',
          timezone: 'UTC',
          reducedMotion: false,
        });
      },
    });

    const initial = await getUserSettings(client);
    expect(initial).toEqual({
      theme: 'system',
      timezone: 'UTC',
      reducedMotion: false,
      locale: 'en',
    });

    const updated = await updateUserSettings(client, { reducedMotion: true, locale: 'es' });
    expect(updated.reducedMotion).toBe(true);
    expect(updated.locale).toBe('es');
    expect(calls[1]).toEqual({
      method: 'PATCH',
      path: '/api/v1/me/settings',
      body: JSON.stringify({ reducedMotion: true, locale: 'es' }),
    });
  });

  test('platform notifications: GET with defaults and PATCH single key', async () => {
    const calls: { method: string; path: string; body?: string }[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push({
          method: init?.method ?? 'GET',
          path: `${url.pathname}${url.search}`,
          body: typeof init?.body === 'string' ? init.body : undefined,
        });
        if (init?.method === 'PATCH') {
          return jsonResponse({
            workspaceId: 'ws/1',
            inApp: { mentions: false, comments: true },
          });
        }
        return jsonResponse({
          workspaceId: 'ws/1',
          inApp: { assignments: false },
        });
      },
    });

    const loaded = await getPlatformNotifications(client, 'ws/1');
    expect(loaded.assignments).toBe(false);
    expect(loaded.mentions).toBe(true);
    expect(Object.keys(loaded)).toEqual([...NOTIFICATION_KEYS]);

    const updated = await updatePlatformNotification(client, 'ws/1', 'mentions', false);
    expect(updated.mentions).toBe(false);
    expect(updated.updates).toBe(true);

    expect(calls[0]?.path).toBe('/api/v1/me/notifications?workspaceId=ws%2F1');
    expect(calls[1]).toEqual({
      method: 'PATCH',
      path: '/api/v1/me/notifications',
      body: JSON.stringify({ workspaceId: 'ws/1', inApp: { mentions: false } }),
    });
  });

  test('sessions: list, revoke, and describeDevice', async () => {
    const calls: { method: string; path: string }[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push({ method: init?.method ?? 'GET', path: url.pathname });
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({
          nodes: [
            {
              id: 'sess-1',
              userAgent: 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36',
              ip: '127.0.0.1',
              createdAt: '2026-11-20T00:00:00.000Z',
              lastUsedAt: '2026-11-26T00:00:00.000Z',
              expiresAt: '2026-12-20T00:00:00.000Z',
            },
          ],
        });
      },
    });

    const sessions = await listSessions(client);
    expect(sessions).toHaveLength(1);
    expect(sessions[0]?.id).toBe('sess-1');

    await revokeSession(client, 'sess-1');
    expect(calls).toEqual([
      { method: 'GET', path: '/api/v1/me/sessions' },
      { method: 'DELETE', path: '/api/v1/me/sessions/sess-1' },
    ]);

    expect(describeDevice(null)).toBe('Unknown device');
    expect(
      describeDevice('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) Chrome/120.0.0.0 Safari/537.36'),
    ).toBe('Chrome on macOS');
    expect(
      describeDevice('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) Safari/604.1'),
    ).toBe('Safari on iOS');
    expect(describeDevice('Mozilla/5.0 (Windows NT 10.0) Edg/120.0')).toBe('Edge on Windows');
    expect(describeDevice('Mozilla/5.0 (Linux; Android 14) Firefox/121.0')).toBe('Firefox on Android');
    expect(describeDevice('Mozilla/5.0 (X11; Linux x86_64) OPR/106.0')).toBe('Opera on Linux');
    expect(describeDevice('CustomAgent/1.0')).toBe('A browser');
  });

  test('channels: list, add, and remove', async () => {
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
        if (init?.method === 'POST') {
          return jsonResponse(
            {
              id: 'ch-2',
              channel: 'EMAIL',
              address: 'alerts@berry.local',
              displayName: null,
              verified: false,
              preferred: true,
              createdAt: '2026-11-26T00:00:00.000Z',
            },
            201,
          );
        }
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({
          nodes: [
            {
              id: 'ch-1',
              channel: 'TELEGRAM',
              address: '@berrydev',
              displayName: 'Berry Dev',
              verified: true,
              preferred: false,
              createdAt: '2026-11-01T00:00:00.000Z',
            },
          ],
        });
      },
    });

    expect(CHANNEL_TYPES).toContain('TELEGRAM');
    const channels = await listChannels(client);
    expect(channels[0]?.address).toBe('@berrydev');

    const added = await addChannel(client, {
      channel: 'EMAIL',
      address: '  alerts@berry.local ',
      preferred: true,
    });
    expect(added.id).toBe('ch-2');

    await removeChannel(client, 'ch-2');
    expect(calls[0]).toEqual({ method: 'GET', path: '/api/v1/me/channels', body: undefined });
    expect(calls[1]).toEqual({
      method: 'POST',
      path: '/api/v1/me/channels',
      body: JSON.stringify({ channel: 'EMAIL', address: 'alerts@berry.local', preferred: true }),
    });
    expect(calls[2]).toEqual({ method: 'DELETE', path: '/api/v1/me/channels/ch-2', body: undefined });
  });

  test('tier models: GET /api/v1/runtimes/tier-models', async () => {
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        expect(url.pathname).toBe('/api/v1/runtimes/tier-models');
        return jsonResponse({
          source: 'workspace',
          tiers: {
            berry_max: ['claude-opus'],
            berry_high: ['claude-sonnet'],
          },
          names: {
            berry_max: 'Max',
          },
        });
      },
    });

    const result = await getTierModels(client);
    expect(result.source).toBe('workspace');
    expect(Object.keys(result.tiers)).toEqual([...TIER_KEYS]);
    expect(result.tiers.berry_max).toEqual(['claude-opus']);
    expect(result.tiers.berry_low).toEqual([]);
    expect(result.names.berry_max).toBe('Max');
    expect(result.names.berry_low).toBe('BerryLow');
  });

  test('skill labels: list filters archived, create, and archive', async () => {
    const calls: { method: string; path: string; body?: string }[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push({
          method: init?.method ?? 'GET',
          path: `${url.pathname}${url.search}`,
          body: typeof init?.body === 'string' ? init.body : undefined,
        });
        if (init?.method === 'POST') {
          return jsonResponse(
            {
              id: 'sl-3',
              workspaceId: 'ws-1',
              name: 'security',
              description: null,
              color: '#6366f1',
              createdAt: '2026-11-26T00:00:00.000Z',
              updatedAt: '2026-11-26T00:00:00.000Z',
              archivedAt: null,
              usageCount: 0,
            },
            201,
          );
        }
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({
          nodes: [
            {
              id: 'sl-1',
              workspaceId: 'ws-1',
              name: 'frontend',
              description: null,
              color: '#347b5a',
              createdAt: '2026-11-01T00:00:00.000Z',
              updatedAt: '2026-11-01T00:00:00.000Z',
              archivedAt: null,
              usageCount: 2,
            },
            {
              id: 'sl-2',
              workspaceId: 'ws-1',
              name: 'legacy',
              description: null,
              color: '#4a5568',
              createdAt: '2026-11-01T00:00:00.000Z',
              updatedAt: '2026-11-02T00:00:00.000Z',
              archivedAt: '2026-11-02T00:00:00.000Z',
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        });
      },
    });

    const labels = await listSkillLabels(client, 'ws-1');
    expect(labels.map((l) => l.id)).toEqual(['sl-1']);

    const created = await createSkillLabel(client, 'ws-1', { name: ' security ', color: '#6366f1' });
    expect(created.id).toBe('sl-3');

    await archiveSkillLabel(client, 'ws-1', 'sl-3');
    expect(calls[0]?.path).toBe('/api/v1/catalogs/ws-1/skill-labels?first=100');
    expect(calls[1]).toEqual({
      method: 'POST',
      path: '/api/v1/catalogs/ws-1/skill-labels',
      body: JSON.stringify({ name: 'security', color: '#6366f1' }),
    });
    expect(calls[2]?.path).toBe('/api/v1/catalogs/ws-1/skill-labels/sl-3');
    expect(calls[2]?.method).toBe('DELETE');
  });

  test('issue properties: list, create, restore, and archive', async () => {
    const calls: { method: string; path: string; body?: string }[] = [];
    const prop = {
      id: 'prop-1',
      workspaceId: 'ws-1',
      name: 'Severity',
      description: 'Impact level',
      kind: 'select' as const,
      options: [{ id: 'opt-1', name: 'High', color: '#E06A58' }],
      icon: null,
      sortOrder: 0,
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      archivedAt: null,
    };

    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push({
          method: init?.method ?? 'GET',
          path: `${url.pathname}${url.search}`,
          body: typeof init?.body === 'string' ? init.body : undefined,
        });
        if (init?.method === 'POST' || init?.method === 'PATCH') {
          return jsonResponse(prop);
        }
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({ nodes: [prop] });
      },
    });

    expect(MAX_ACTIVE_PROPERTIES).toBe(20);
    expect(PROPERTY_KINDS).toContain('multi_select');

    const withArchived = await listIssueProperties(client, 'ws-1');
    expect(withArchived).toHaveLength(1);

    await listIssueProperties(client, 'ws-1', false);
    await createIssueProperty(client, 'ws-1', {
      name: ' Severity ',
      kind: 'select',
      options: prop.options,
      description: 'Impact level',
    });
    await restoreIssueProperty(client, 'ws-1', 'prop-1');
    await archiveIssueProperty(client, 'ws-1', 'prop-1');

    expect(calls[0]?.path).toBe('/api/v1/catalogs/ws-1/issue-properties?includeArchived=true');
    expect(calls[1]?.path).toBe('/api/v1/catalogs/ws-1/issue-properties');
    expect(calls[2]).toEqual({
      method: 'POST',
      path: '/api/v1/catalogs/ws-1/issue-properties',
      body: JSON.stringify({
        name: 'Severity',
        kind: 'select',
        options: prop.options,
        description: 'Impact level',
      }),
    });
    expect(calls[3]).toEqual({
      method: 'PATCH',
      path: '/api/v1/catalogs/ws-1/issue-properties/prop-1',
      body: JSON.stringify({ archived: false }),
    });
    expect(calls[4]).toEqual({
      method: 'DELETE',
      path: '/api/v1/catalogs/ws-1/issue-properties/prop-1',
      body: undefined,
    });
  });

  test('quick actions: list, restore, and archive', async () => {
    const calls: { method: string; path: string; body?: string }[] = [];
    const action = {
      id: 'qa-1',
      workspaceId: 'ws-1',
      name: 'Triage',
      description: 'Classify bug',
      targetAgentId: 'agent-1',
      prompt: 'Triage {{issue.title}}',
      visibility: 'workspace' as const,
      createdBy: 'u-1',
      createdAt: '2026-11-01T00:00:00.000Z',
      updatedAt: '2026-11-01T00:00:00.000Z',
      useCount: 3,
      lastUsedAt: '2026-11-25T00:00:00.000Z',
      archivedAt: null,
    };

    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push({
          method: init?.method ?? 'GET',
          path: `${url.pathname}${url.search}`,
          body: typeof init?.body === 'string' ? init.body : undefined,
        });
        if (init?.method === 'PATCH') {
          return jsonResponse(action);
        }
        if (init?.method === 'DELETE') {
          return new Response(null, { status: 204 });
        }
        return jsonResponse({ nodes: [action] });
      },
    });

    const loaded = await listQuickActions(client, 'ws-1');
    expect(loaded[0]?.name).toBe('Triage');

    await listQuickActions(client, 'ws-1', false);
    await restoreQuickAction(client, 'ws-1', 'qa-1');
    await archiveQuickAction(client, 'ws-1', 'qa-1');

    expect(calls[0]?.path).toBe('/api/v1/catalogs/ws-1/quick-actions?includeArchived=true');
    expect(calls[1]?.path).toBe('/api/v1/catalogs/ws-1/quick-actions');
    expect(calls[2]).toEqual({
      method: 'PATCH',
      path: '/api/v1/catalogs/ws-1/quick-actions/qa-1',
      body: JSON.stringify({ archived: false }),
    });
    expect(calls[3]).toEqual({
      method: 'DELETE',
      path: '/api/v1/catalogs/ws-1/quick-actions/qa-1',
      body: undefined,
    });
  });
});
