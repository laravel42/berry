import { describe, expect, test } from 'bun:test';

import { ApiClientError, createBerryClient } from './client';

function jsonResponse(body: unknown, status = 200, headers: Record<string, string> = {}): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json', ...headers },
  });
}

describe('BerryClient', () => {
  test('sends Bearer token and parses camelCase JSON', async () => {
    let seenUrl = '';
    let seenAuth = '';
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_id_secret',
      fetchImpl: async (input, init) => {
        seenUrl = String(input);
        const headers = new Headers(init?.headers);
        seenAuth = headers.get('authorization') ?? '';
        return jsonResponse({ currentWorkspaceId: 'ws-1', unknownFutureField: true });
      },
    });

    const data = await client.get<{ currentWorkspaceId: string }>('/api/v1/me/bootstrap');
    expect(seenUrl).toBe('https://berry.example.com/api/v1/me/bootstrap');
    expect(seenAuth).toBe('Bearer berry_pat_id_secret');
    expect(data.currentWorkspaceId).toBe('ws-1');
  });

  test('attaches Idempotency-Key of length 16..128 when idempotent=true', async () => {
    let seenKey = '';
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_id_secret',
      fetchImpl: async (_input, init) => {
        const headers = new Headers(init?.headers);
        seenKey = headers.get('idempotency-key') ?? '';
        return jsonResponse({ id: 'issue-1' }, 201);
      },
    });

    await client.post('/api/v1/issues', { title: 'Test' }, { idempotent: true });
    expect(seenKey.length).toBeGreaterThanOrEqual(16);
    expect(seenKey.length).toBeLessThanOrEqual(128);
  });

  test('parses Berry ErrorEnvelope into ApiClientError', async () => {
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_id_secret',
      fetchImpl: async () =>
        jsonResponse(
          {
            error: {
              code: 'VALIDATION_FAILED',
              message: 'The request is invalid.',
              requestId: 'req_123',
              details: {
                fields: [{ path: '/title', code: 'too_small', message: 'Title is required.' }],
              },
            },
          },
          422,
          { 'x-request-id': 'req_123' },
        ),
    });

    let caught: unknown = null;
    try {
      await client.post('/api/v1/issues', { title: '' });
    } catch (error) {
      caught = error;
    }

    expect(caught instanceof ApiClientError).toBe(true);
    const err = caught as ApiClientError;
    expect(err.status).toBe(422);
    expect(err.code).toBe('VALIDATION_FAILED');
    expect(err.message).toBe('The request is invalid.');
    expect(err.requestId).toBe('req_123');
    expect(err.fieldErrors()).toEqual([{ path: '/title', code: 'too_small', message: 'Title is required.' }]);
  });

  test('fires onUnauthorized exactly once across concurrent 401 responses', async () => {
    let unauthorizedCalls = 0;
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_expired',
      onUnauthorized: () => {
        unauthorizedCalls += 1;
      },
      fetchImpl: async () =>
        jsonResponse(
          {
            error: {
              code: 'UNAUTHENTICATED',
              message: 'Authentication required.',
              requestId: 'req_401',
              details: null,
            },
          },
          401,
        ),
    });

    const results = await Promise.allSettled([
      client.get('/api/v1/me/bootstrap'),
      client.get('/api/v1/inbox'),
    ]);

    expect(results[0]?.status).toBe('rejected');
    expect(results[1]?.status).toBe('rejected');
    expect(unauthorizedCalls).toBe(1);
  });
});
