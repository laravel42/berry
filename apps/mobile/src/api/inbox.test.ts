import { describe, expect, test } from 'bun:test';

import { createBerryClient } from '@/api/client';
import type { ApiInboxItem } from '@/api/types';
import { createInboxStore } from '@/store/inbox-store';

import { mapInboxKind } from './inbox';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function makeItem(overrides: Partial<ApiInboxItem> = {}): ApiInboxItem {
  return {
    id: '11111111-1111-4111-8111-111111111111',
    workspaceId: 'ws-1',
    recipientId: 'u-1',
    eventType: 'issue.mentioned',
    category: 'mention',
    severity: 'normal',
    issueId: 'issue-1',
    issueStatus: 'in_progress',
    issueIdentifier: 'LAR-12',
    actorType: 'user',
    actorId: 'u-2',
    title: 'Check export column',
    body: 'Lena mentioned you',
    details: null,
    read: false,
    archived: false,
    createdAt: '2026-11-25T17:50:00.000Z',
    approvalId: null,
    milestoneId: null,
    planId: null,
    ...overrides,
  };
}

describe('inbox API & store', () => {
  test('maps server eventType/category/approvalId into display kind and needs flag with safe fallback', () => {
    expect(mapInboxKind(makeItem({ approvalId: 'app-1', eventType: 'approval.requested' }))).toEqual({
      kind: 'approval',
      needs: true,
    });
    expect(mapInboxKind(makeItem({ eventType: 'review.requested', issueStatus: 'in_review' }))).toEqual({
      kind: 'review',
      needs: true,
    });
    expect(mapInboxKind(makeItem({ eventType: 'run.failed', severity: 'error' }))).toEqual({
      kind: 'failed',
      needs: true,
    });
    expect(mapInboxKind(makeItem({ eventType: 'issue.blocked' }))).toEqual({
      kind: 'blocked',
      needs: true,
    });
    expect(mapInboxKind(makeItem({ eventType: 'issue.assigned' }))).toEqual({
      kind: 'assigned',
      needs: false,
    });
    expect(mapInboxKind(makeItem({ eventType: 'unknown.future.event', category: 'other' }))).toEqual({
      kind: 'mention',
      needs: false,
    });
  });

  test('reverts optimistic read/archive state when server returns 500', async () => {
    const item = makeItem({ read: false, archived: false });
    const toasts: string[] = [];
    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        if (init?.method === 'POST') {
          return jsonResponse(
            { error: { code: 'INTERNAL', message: 'Boom', requestId: 'r1', details: null } },
            500,
          );
        }
        if (String(input).includes('/unread-count')) {
          return jsonResponse({ count: 1 });
        }
        return jsonResponse({ nodes: [item], pageInfo: { hasNextPage: false, endCursor: null } });
      },
    });

    const store = createInboxStore((msg) => toasts.push(msg));
    await store.getState().load(client, 'ws-1');
    expect(store.getState().items[0]?.read).toBe(false);
    expect(store.getState().unreadCount).toBe(1);

    await store.getState().toggleRead(client, 'ws-1', item.id);
    expect(store.getState().items[0]?.read).toBe(false);
    expect(store.getState().unreadCount).toBe(1);
    expect(toasts.length).toBeGreaterThanOrEqual(1);

    await store.getState().archive(client, 'ws-1', item.id);
    expect(store.getState().items[0]?.archived).toBe(false);
  });

  test('markAllRead batches active unread itemIds into POST /api/v1/inbox/bulk', async () => {
    const item1 = makeItem({ id: '11111111-1111-4111-8111-111111111111', read: false });
    const item2 = makeItem({ id: '22222222-2222-4222-8222-222222222222', read: true });
    let seenBulkBody: unknown = null;

    const client = createBerryClient({
      baseUrl: 'https://berry.example.com',
      token: 'berry_pat_test',
      fetchImpl: async (input, init) => {
        if (String(input).endsWith('/api/v1/inbox/bulk')) {
          seenBulkBody = JSON.parse(String(init?.body ?? '{}'));
          return jsonResponse({ changed: 1 });
        }
        if (String(input).includes('/unread-count')) {
          return jsonResponse({ count: 1 });
        }
        return jsonResponse({ nodes: [item1, item2], pageInfo: { hasNextPage: false, endCursor: null } });
      },
    });

    const store = createInboxStore();
    await store.getState().load(client, 'ws-1');
    await store.getState().markAllRead(client, 'ws-1');

    expect(seenBulkBody).toEqual({
      workspaceId: 'ws-1',
      itemIds: [item1.id],
      action: 'read',
    });
    expect(store.getState().items.every((entry) => entry.read)).toBe(true);
    expect(store.getState().unreadCount).toBe(0);
  });
});
