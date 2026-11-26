import { describe, expect, test } from 'bun:test';

import type { ApiConversation } from '@/api/types';
import type { ActorView } from '@/model/mappers';

import {
  buildAgentRoster,
  filterAgentRoster,
  filterAgentRosterByCriteria,
  formatAgentRole,
} from './agents-helpers';

const orchestrator: ActorView = {
  id: 'ag-orch',
  type: 'agent',
  name: 'Berry',
  initials: 'B',
  avatarUrl: null,
  roleKey: 'orchestrator',
  description: 'Coordinates tasks across the team',
  status: 'idle',
};

const engineer: ActorView = {
  id: 'ag-eng',
  type: 'agent',
  name: 'Ada',
  initials: 'A',
  avatarUrl: null,
  roleKey: 'software-engineer',
  description: 'Implements backend and mobile features',
  status: 'running',
};

const reviewer: ActorView = {
  id: 'ag-rev',
  type: 'agent',
  name: 'Lin',
  initials: 'L',
  avatarUrl: null,
  roleKey: 'reviewer',
  description: 'Reviews pull requests',
  status: 'idle',
};

function makeConv(overrides: Partial<ApiConversation>): ApiConversation {
  return {
    id: 'conv-1',
    kind: 'agent',
    topic: '',
    agentId: 'ag-eng',
    agentName: 'Ada',
    messageCount: 3,
    updatedAt: '2026-11-25T12:00:00.000Z',
    pinned: false,
    archived: false,
    unread: 0,
    activeRunId: null,
    draft: '',
    lastMessage: 'PR is ready for review',
    lastMessageAuthor: 'agent',
    ...overrides,
  };
}

describe('agents helpers', () => {
  test('formats role keys into readable labels', () => {
    expect(formatAgentRole('software-engineer')).toBe('Software engineer');
    expect(formatAgentRole('orchestrator')).toBe('Orchestrator');
    expect(formatAgentRole(null)).toBe('Agent');
  });

  test('merges conversations with agents and sorts unread then recent then orchestrator', () => {
    const roster = buildAgentRoster(
      [reviewer, engineer, orchestrator],
      [
        makeConv({ id: 'conv-rev', agentId: 'ag-rev', unread: 2, updatedAt: '2026-11-25T10:00:00.000Z' }),
        makeConv({ id: 'conv-eng', agentId: 'ag-eng', unread: 0, updatedAt: '2026-11-25T15:00:00.000Z' }),
      ],
    );

    expect(roster.map((item) => item.agent.id)).toEqual(['ag-rev', 'ag-eng', 'ag-orch']);
    expect(roster[0]?.unread).toBe(2);
    expect(roster[0]?.conversationId).toBe('conv-rev');
    expect(roster[2]?.conversationId).toBeNull();
  });

  test('filters roster by name, role, or description', () => {
    const roster = buildAgentRoster([orchestrator, engineer, reviewer], []);
    expect(filterAgentRoster(roster, 'software').map((r) => r.agent.id)).toEqual(['ag-eng']);
    expect(filterAgentRoster(roster, 'reviews').map((r) => r.agent.id)).toEqual(['ag-rev']);
    expect(filterAgentRoster(roster, '').length).toBe(3);
  });

  test('filters roster by working, unread, and active_chat criteria combined with query', () => {
    const roster = buildAgentRoster(
      [orchestrator, engineer, reviewer],
      [
        makeConv({ id: 'conv-rev', agentId: 'ag-rev', unread: 2, updatedAt: '2026-11-25T10:00:00.000Z' }),
        makeConv({ id: 'conv-eng', agentId: 'ag-eng', unread: 0, updatedAt: '2026-11-25T15:00:00.000Z' }),
      ],
    );

    expect(filterAgentRosterByCriteria(roster, '', 'all')).toHaveLength(3);
    expect(filterAgentRosterByCriteria(roster, '', 'working').map((r) => r.agent.id)).toEqual(['ag-eng']);
    expect(filterAgentRosterByCriteria(roster, '', 'unread').map((r) => r.agent.id)).toEqual(['ag-rev']);
    expect(filterAgentRosterByCriteria(roster, '', 'active_chat').map((r) => r.agent.id)).toEqual([
      'ag-rev',
      'ag-eng',
    ]);
    expect(filterAgentRosterByCriteria(roster, 'ada', 'active_chat').map((r) => r.agent.id)).toEqual(['ag-eng']);
    expect(filterAgentRosterByCriteria(roster, 'berry', 'active_chat')).toEqual([]);
  });
});
