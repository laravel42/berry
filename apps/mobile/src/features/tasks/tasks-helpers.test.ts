import { describe, expect, test } from 'bun:test';

import { isGroupCollapsed, toggleGroupCollapsed } from './tasks-helpers';

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
});
