import { describe, expect, test } from 'bun:test';

import type { ApiIssue } from '@/api/types';

import { filterTasks, isGroupCollapsed, toggleGroupCollapsed } from './tasks-helpers';

function makeIssue(id: string, overrides: Partial<ApiIssue> = {}): ApiIssue {
  return {
    id,
    boardId: 'board-1',
    number: Number(id) || 1,
    identifier: `BER-${id}`,
    title: `Task ${id}`,
    description: null,
    status: 'todo',
    priority: 'medium',
    sortOrder: 0,
    startDate: null,
    dueDate: null,
    assignee: null,
    activeRunId: null,
    project: null,
    createdBy: null,
    createdAt: '2026-11-20T00:00:00.000Z',
    updatedAt: '2026-11-25T00:00:00.000Z',
    ...overrides,
  };
}

describe('tasks helpers', () => {
  test('reports groups as expanded by default', () => {
    expect(isGroupCollapsed({}, 'inProgress')).toBe(false);
    expect(isGroupCollapsed({ todo: false }, 'todo')).toBe(false);
    expect(isGroupCollapsed({ done: true }, 'done')).toBe(true);
  });

  test('toggles a group between collapsed and expanded without mutating input', () => {
    const initial: Record<string, boolean> = { backlog: true };

    const collapsed = toggleGroupCollapsed(initial, 'inProgress');
    expect(collapsed).toEqual({ backlog: true, inProgress: true });
    expect(initial).toEqual({ backlog: true });
    expect(isGroupCollapsed(collapsed, 'inProgress')).toBe(true);

    const expanded = toggleGroupCollapsed(collapsed, 'inProgress');
    expect(expanded).toEqual({ backlog: true, inProgress: false });
    expect(collapsed).toEqual({ backlog: true, inProgress: true });
    expect(isGroupCollapsed(expanded, 'inProgress')).toBe(false);
  });

  test('filters tasks by priority and search query across title, identifier, description, and assignee', () => {
    const issues = [
      makeIssue('1', {
        identifier: 'BER-11',
        title: 'Fix OAuth redirect',
        description: 'Mobile deep link fails on Android',
        priority: 'urgent',
        assignee: { type: 'user', id: 'u-1', name: 'Eduardo', avatarUrl: null },
      }),
      makeIssue('2', {
        identifier: 'BER-12',
        title: 'Add search bar',
        description: 'Consistent chips across screens',
        priority: 'high',
        assignee: { type: 'agent', id: 'a-1', name: 'Ada', avatarUrl: null },
      }),
      makeIssue('3', {
        identifier: 'BER-13',
        title: 'Polish icons',
        description: null,
        priority: 'low',
        assignee: null,
      }),
    ];

    expect(filterTasks(issues, '', 'all')).toHaveLength(3);
    expect(filterTasks(issues, '', 'urgent').map((i) => i.id)).toEqual(['1']);
    expect(filterTasks(issues, '', 'high').map((i) => i.id)).toEqual(['2']);
    expect(filterTasks(issues, '', 'low').map((i) => i.id)).toEqual(['3']);
    expect(filterTasks(issues, '', 'medium')).toEqual([]);

    expect(filterTasks(issues, 'oauth', 'all').map((i) => i.id)).toEqual(['1']);
    expect(filterTasks(issues, 'BER-12', 'all').map((i) => i.id)).toEqual(['2']);
    expect(filterTasks(issues, 'android', 'all').map((i) => i.id)).toEqual(['1']);
    expect(filterTasks(issues, 'ada', 'all').map((i) => i.id)).toEqual(['2']);
    expect(filterTasks(issues, 'ada', 'urgent')).toEqual([]);
  });
});
