import { describe, expect, test } from 'bun:test';

import { ApiClientError, createBerryClient } from '@/api/client';
import type { ApiIssue } from '@/api/types';

import { approveIssueReview, resolveApproval } from './decisions';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeDoneIssue(): ApiIssue {
  return {
    id: 'issue-1',
    boardId: 'board-1',
    number: 1,
    identifier: 'LAR-1',
    title: 'Delivered task',
    description: null,
    status: 'done',
    priority: 'medium',
    sortOrder: 0,
    startDate: null,
    dueDate: null,
    assignee: null,
    activeRunId: null,
    project: null,
    createdBy: null,
    createdAt: '',
    updatedAt: '',
  };
}

describe('decisions API', () => {
  test('approveIssueReview merges open PR before PATCH status=done', async () => {
    const calls: string[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
        if (url.pathname === '/api/v1/reviews/run-42/merge') {
          return jsonResponse({ merged: true, number: 212, sha: 'abc', already: false });
        }
        if (url.pathname === '/api/v1/issues/issue-1') {
          expect(JSON.parse(String(init?.body ?? '{}'))).toEqual({ status: 'done' });
          return jsonResponse(makeDoneIssue());
        }
        return jsonResponse({}, 404);
      },
    });

    const updated = await approveIssueReview(client, { issueId: 'issue-1', mergeRunId: 'run-42' });
    expect(calls).toEqual(['POST /api/v1/reviews/run-42/merge', 'PATCH /api/v1/issues/issue-1']);
    expect(updated.status).toBe('done');
  });

  test('approveIssueReview aborts PATCH done when merge returns 409 MERGE_CONFLICT', async () => {
    const calls: string[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push(`${init?.method ?? 'GET'} ${url.pathname}`);
        return jsonResponse(
          {
            error: {
              code: 'MERGE_CONFLICT',
              message: 'Pull request #212 conflicts with main, so it was sent back to Software Engineer.',
              requestId: 'req-conflict',
              details: { number: 212, sentBack: true },
            },
          },
          409,
        );
      },
    });

    let caught: unknown = null;
    try {
      await approveIssueReview(client, { issueId: 'issue-1', mergeRunId: 'run-42' });
    } catch (error) {
      caught = error;
    }

    expect(calls).toEqual(['POST /api/v1/reviews/run-42/merge']);
    expect(caught instanceof ApiClientError).toBe(true);
    expect((caught as ApiClientError).code).toBe('MERGE_CONFLICT');
  });

  test('resolveApproval posts to /api/v1/approvals/:id/approve|reject with Idempotency-Key', async () => {
    const calls: { path: string; key: string; body: unknown }[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push({
          path: url.pathname,
          key: new Headers(init?.headers).get('idempotency-key') ?? '',
          body: JSON.parse(String(init?.body ?? '{}')),
        });
        return jsonResponse({
          id: 'app-1',
          workspaceId: 'ws-1',
          kind: 'issueStart',
          risk: 'high',
          title: 'Drop legacy table',
          description: null,
          issueId: 'issue-1',
          status: url.pathname.endsWith('/approve') ? 'approved' : 'rejected',
          decisionNote: null,
          requestedAt: '',
          resolvedAt: '2026-11-25T12:00:00.000Z',
        });
      },
    });

    await resolveApproval(client, 'app-1', 'approve', 'Safe after backup');
    await resolveApproval(client, 'app-2', 'reject');

    expect(calls[0]?.path).toBe('/api/v1/approvals/app-1/approve');
    expect((calls[0]?.key ?? '').length).toBeGreaterThanOrEqual(16);
    expect(calls[0]?.body).toEqual({ note: 'Safe after backup' });
    expect(calls[1]?.path).toBe('/api/v1/approvals/app-2/reject');
    expect((calls[1]?.key ?? '').length).toBeGreaterThanOrEqual(16);
    expect(calls[1]?.body).toEqual({});
  });
});
