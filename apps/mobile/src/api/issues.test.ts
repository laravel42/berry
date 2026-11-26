import { describe, expect, test } from 'bun:test';

import { createBerryClient } from '@/api/client';
import type { ApiIssue } from '@/api/types';
import { formatRelativeTime } from '@/model/mappers';

import {
  createIssueComment,
  listAllBoardIssues,
  listBoardIssues,
  listIssueLabels,
  sendBackIssue,
  splitMyIssues,
} from './issues';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeIssue(overrides: Partial<ApiIssue> = {}): ApiIssue {
  return {
    id: 'issue-1',
    boardId: 'board-1',
    number: 1,
    identifier: 'LAR-1',
    title: 'Wire mobile issues',
    description: 'Details',
    status: 'inReview',
    priority: 'high',
    sortOrder: 100,
    startDate: null,
    dueDate: null,
    assignee: { type: 'user', id: 'user-me', name: 'Eduardo', avatarUrl: null },
    activeRunId: null,
    project: { id: 'p-1', name: 'Mobile' },
    createdBy: { type: 'user', id: 'user-other', name: 'Lena', avatarUrl: null },
    createdAt: '2026-11-25T10:00:00.000Z',
    updatedAt: '2026-11-25T11:00:00.000Z',
    ...overrides,
  };
}

describe('issues API', () => {
  test('splits board issues into assigned-to-me and created-by-me by authenticated user id', () => {
    const a = makeIssue({
      id: 'i-assigned',
      assignee: { type: 'user', id: 'user-me', name: 'Me', avatarUrl: null },
      createdBy: { type: 'user', id: 'user-other', name: 'Other', avatarUrl: null },
    });
    const b = makeIssue({
      id: 'i-created',
      assignee: { type: 'agent', id: 'agent-1', name: 'SE', avatarUrl: null },
      createdBy: { type: 'user', id: 'user-me', name: 'Me', avatarUrl: null },
    });
    const c = makeIssue({
      id: 'i-agent-same-id-guard',
      assignee: { type: 'agent', id: 'user-me', name: 'Not a human', avatarUrl: null },
      createdBy: { type: 'user', id: 'user-other', name: 'Other', avatarUrl: null },
    });

    const split = splitMyIssues([a, b, c], 'user-me');
    expect(split.assigned.map((x) => x.id)).toEqual(['i-assigned']);
    expect(split.created.map((x) => x.id)).toEqual(['i-created']);
  });

  test('listBoardIssues passes assigneeType and assigneeId query params when provided', async () => {
    let seenUrl = '';
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input) => {
        seenUrl = String(input);
        return jsonResponse({ nodes: [], pageInfo: { hasNextPage: false, endCursor: null } });
      },
    });

    await listBoardIssues(client, 'board-1', { assigneeType: 'user', assigneeId: 'user-me' });
    const parsed = new URL(seenUrl);
    expect(parsed.searchParams.get('boardId')).toBe('board-1');
    expect(parsed.searchParams.get('assigneeType')).toBe('user');
    expect(parsed.searchParams.get('assigneeId')).toBe('user-me');
  });

  test('createIssueComment sends Idempotency-Key and { body }', async () => {
    let seenKey = '';
    let seenBody: unknown = null;
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (_input, init) => {
        seenKey = new Headers(init?.headers).get('idempotency-key') ?? '';
        seenBody = JSON.parse(String(init?.body ?? '{}'));
        return jsonResponse(
          {
            id: 'c-1',
            issueId: 'issue-1',
            body: 'Looks good',
            author: { type: 'user', id: 'user-me', name: 'Me', avatarUrl: null },
            parentId: null,
            createdAt: '2026-11-25T12:00:00.000Z',
            updatedAt: '2026-11-25T12:00:00.000Z',
          },
          201,
        );
      },
    });

    const comment = await createIssueComment(client, 'issue-1', 'Looks good');
    expect(seenKey.length).toBeGreaterThanOrEqual(16);
    expect(seenBody).toEqual({ body: 'Looks good' });
    expect(comment.id).toBe('c-1');
  });

  test('sendBackIssue posts feedback comment then PATCHes status to todo', async () => {
    const calls: { method: string; path: string; body: unknown }[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        const url = new URL(String(input));
        calls.push({
          method: init?.method ?? 'GET',
          path: url.pathname,
          body: init?.body ? JSON.parse(String(init.body)) : null,
        });
        if (url.pathname.endsWith('/comments')) {
          return jsonResponse(
            {
              id: 'c-2',
              issueId: 'issue-1',
              body: 'Please add unit tests',
              author: { type: 'user', id: 'user-me', name: 'Me', avatarUrl: null },
              parentId: null,
              createdAt: '2026-11-25T12:00:00.000Z',
              updatedAt: '2026-11-25T12:00:00.000Z',
            },
            201,
          );
        }
        return jsonResponse(makeIssue({ status: 'todo' }), 200);
      },
    });

    const updated = await sendBackIssue(client, 'issue-1', 'Please add unit tests');
    expect(calls).toEqual([
      { method: 'POST', path: '/api/v1/issues/issue-1/comments', body: { body: 'Please add unit tests' } },
      { method: 'PATCH', path: '/api/v1/issues/issue-1', body: { status: 'todo' } },
    ]);
    expect(updated.status).toBe('todo');
  });

  test('listAllBoardIssues follows cursor pagination until hasNextPage is false', async () => {
    const seenAfter: (string | null)[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input) => {
        const url = new URL(String(input));
        const after = url.searchParams.get('after');
        seenAfter.push(after);
        if (!after) {
          return jsonResponse({
            nodes: [makeIssue({ id: 'i-1' }), makeIssue({ id: 'i-2' })],
            pageInfo: { hasNextPage: true, endCursor: 'cursor-2' },
          });
        }
        return jsonResponse({
          nodes: [makeIssue({ id: 'i-3' })],
          pageInfo: { hasNextPage: false, endCursor: null },
        });
      },
    });

    const all = await listAllBoardIssues(client, 'board-1');
    expect(seenAfter).toEqual([null, 'cursor-2']);
    expect(all.map((i) => i.id)).toEqual(['i-1', 'i-2', 'i-3']);
  });

  test('listIssueLabels fetches /api/v1/issues/:ref/labels and returns nodes', async () => {
    let seenPath = '';
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input) => {
        seenPath = new URL(String(input)).pathname;
        return jsonResponse({
          nodes: [
            {
              id: 'lbl-1',
              name: 'mobile',
              color: '#C9325C',
              description: null,
              archivedAt: null,
            },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        });
      },
    });

    const labels = await listIssueLabels(client, 'LAR-1');
    expect(seenPath).toBe('/api/v1/issues/LAR-1/labels');
    expect(labels).toEqual([
      {
        id: 'lbl-1',
        name: 'mobile',
        color: '#C9325C',
        description: null,
        archivedAt: null,
      },
    ]);
  });

  test('formatRelativeTime rounds days to match web date-fns formatDistanceToNow', () => {
    const now = Date.parse('2026-11-26T18:00:00.000Z');
    // 6 days and 14 hours ago -> rounds to 7d (matching "7 days ago" on web)
    const sixDaysFourteenHoursAgo = new Date(now - (6 * 24 + 14) * 3600 * 1000).toISOString();
    expect(formatRelativeTime(sixDaysFourteenHoursAgo, now)).toBe('7d');
    // 6 days and 4 hours ago -> stays 6d
    const sixDaysFourHoursAgo = new Date(now - (6 * 24 + 4) * 3600 * 1000).toISOString();
    expect(formatRelativeTime(sixDaysFourHoursAgo, now)).toBe('6d');
  });
});
