import type { ApiIssue } from '@/api/types';
import { mapApiPriority } from '@/model/mappers';

export type TaskScopeTab = 'assigned' | 'created' | 'all';

export type TaskPriorityFilter = 'all' | 'urgent' | 'high' | 'medium' | 'low';

export function isGroupCollapsed(collapsed: Record<string, boolean>, status: string): boolean {
  return collapsed[status] === true;
}

export function toggleGroupCollapsed(
  collapsed: Record<string, boolean>,
  status: string,
): Record<string, boolean> {
  return {
    ...collapsed,
    [status]: !isGroupCollapsed(collapsed, status),
  };
}

export function filterTasks(
  issues: readonly ApiIssue[],
  query: string,
  priority: TaskPriorityFilter,
): ApiIssue[] {
  const needle = query.trim().toLowerCase();
  return issues.filter((issue) => {
    if (priority !== 'all' && mapApiPriority(issue.priority) !== priority) {
      return false;
    }
    if (!needle) return true;
    const title = issue.title.toLowerCase();
    const identifier = issue.identifier.toLowerCase();
    const description = (issue.description ?? '').toLowerCase();
    const assigneeName = (issue.assignee?.name ?? '').toLowerCase();
    return (
      title.includes(needle) ||
      identifier.includes(needle) ||
      description.includes(needle) ||
      assigneeName.includes(needle)
    );
  });
}
