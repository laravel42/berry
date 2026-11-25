import { describe, expect, test } from 'bun:test';

import type { ApiInboxItem } from '@/api/types';

import {
  buildInboxNotificationPayload,
  findNewUnreadInboxItems,
  resolveNotificationRoute,
} from './notifications-logic';

function makeItem(overrides: Partial<ApiInboxItem>): ApiInboxItem {
  return {
    id: 'item-1',
    workspaceId: 'ws-1',
    recipientId: 'user-1',
    eventType: 'issue.review_requested',
    category: 'review',
    severity: 'normal',
    issueId: 'iss-42',
    issueStatus: 'inReview',
    issueIdentifier: 'BER-42',
    actorType: 'agent',
    actorId: 'ag-1',
    title: 'Review requested',
    body: 'Ada opened PR #42 on Mobile App',
    details: null,
    read: false,
    archived: false,
    createdAt: '2026-11-25T16:00:00.000Z',
    approvalId: null,
    milestoneId: null,
    planId: null,
    ...overrides,
  };
}

describe('notifications logic', () => {
  test('skips notifications on initial hydration and returns only newly arrived unread items thereafter', () => {
    const first = makeItem({ id: 'a', read: false });
    const second = makeItem({ id: 'b', read: true });
    const third = makeItem({ id: 'c', read: false });

    expect(findNewUnreadInboxItems(null, [first, second])).toEqual([]);
    expect(findNewUnreadInboxItems(new Set(['a']), [first, second, third]).map((i) => i.id)).toEqual(['c']);
  });

  test('builds readable title, body, and deep-link data from an inbox item', () => {
    const payload = buildInboxNotificationPayload(makeItem({}));
    expect(payload.title).toBe('BER-42 · Review requested');
    expect(payload.body).toBe('Ada opened PR #42 on Mobile App');
    expect(payload.data).toEqual({ issueId: 'iss-42', itemId: 'item-1' });
  });

  test('resolves notification tap destination safely', () => {
    expect(resolveNotificationRoute({ issueId: 'iss-42' })).toBe('/issue/iss-42');
    expect(resolveNotificationRoute({ issueId: '' })).toBe('/');
    expect(resolveNotificationRoute(null)).toBe('/');
  });
});
