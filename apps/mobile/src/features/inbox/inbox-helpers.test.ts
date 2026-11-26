import { describe, expect, test } from 'bun:test';

import type { ApiInboxItem } from '@/api/types';
import type { NotifKind } from '@/model/types';

import { filterInboxEntries } from './inbox-helpers';

function makeEntry(
  id: string,
  overrides: Partial<ApiInboxItem>,
  meta: { kind: NotifKind; needs: boolean },
) {
  const item: ApiInboxItem = {
    id,
    workspaceId: 'ws-1',
    recipientId: 'user-1',
    eventType: 'issue.review_requested',
    category: 'review',
    severity: 'info',
    issueId: `issue-${id}`,
    issueStatus: 'inReview',
    issueIdentifier: `BER-${id}`,
    actorType: 'agent',
    actorId: 'agent-1',
    title: `Notification ${id}`,
    body: `Body for ${id}`,
    details: null,
    read: false,
    archived: false,
    createdAt: '2026-11-25T10:00:00.000Z',
    approvalId: null,
    milestoneId: null,
    planId: null,
    ...overrides,
  };
  return { item, meta };
}

describe('inbox helpers', () => {
  const entries = [
    makeEntry(
      '1',
      { title: 'Review PR for auth', body: 'Ready for human gate', issueIdentifier: 'BER-101', read: false },
      { kind: 'review', needs: true },
    ),
    makeEntry(
      '2',
      { title: 'Approval requested', body: 'Deploy to staging', issueIdentifier: 'BER-102', read: true },
      { kind: 'approval', needs: true },
    ),
    makeEntry(
      '3',
      { title: 'Run failed on CI', body: 'Typecheck error in mobile', issueIdentifier: 'BER-103', read: false },
      { kind: 'failed', needs: true },
    ),
    makeEntry(
      '4',
      { title: 'Mentioned in comment', body: 'Can you check the design?', issueIdentifier: 'BER-104', read: true },
      { kind: 'mention', needs: false },
    ),
    makeEntry(
      '5',
      { title: 'Assigned to you', body: 'Fix header alignment', issueIdentifier: null, read: false },
      { kind: 'assigned', needs: false },
    ),
  ];

  test('returns all entries when filter is all and query is blank', () => {
    expect(filterInboxEntries(entries, '', 'all')).toHaveLength(5);
    expect(filterInboxEntries(entries, '   ', 'all')).toHaveLength(5);
  });

  test('filters by unread, needs, and specific notification kinds', () => {
    expect(filterInboxEntries(entries, '', 'unread').map((e) => e.item.id)).toEqual(['1', '3', '5']);
    expect(filterInboxEntries(entries, '', 'needs').map((e) => e.item.id)).toEqual(['1', '2', '3']);
    expect(filterInboxEntries(entries, '', 'review').map((e) => e.item.id)).toEqual(['1']);
    expect(filterInboxEntries(entries, '', 'approval').map((e) => e.item.id)).toEqual(['2']);
    expect(filterInboxEntries(entries, '', 'failed').map((e) => e.item.id)).toEqual(['3']);
    expect(filterInboxEntries(entries, '', 'mention').map((e) => e.item.id)).toEqual(['4']);
    expect(filterInboxEntries(entries, '', 'assigned').map((e) => e.item.id)).toEqual(['5']);
    expect(filterInboxEntries(entries, '', 'blocked')).toEqual([]);
  });

  test('matches query case-insensitively across title, body, and issueIdentifier', () => {
    expect(filterInboxEntries(entries, 'AUTH', 'all').map((e) => e.item.id)).toEqual(['1']);
    expect(filterInboxEntries(entries, 'staging', 'all').map((e) => e.item.id)).toEqual(['2']);
    expect(filterInboxEntries(entries, 'ber-103', 'all').map((e) => e.item.id)).toEqual(['3']);
  });

  test('combines filter and query', () => {
    expect(filterInboxEntries(entries, 'ber-10', 'unread').map((e) => e.item.id)).toEqual(['1', '3']);
    expect(filterInboxEntries(entries, 'staging', 'unread')).toEqual([]);
  });
});
