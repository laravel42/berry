'use client';

import { PriorityPicker } from '@/components/common/pickers/priority-picker';
import { ISSUE_STATUS_OPTIONS, StatusPicker } from '@/components/common/pickers/status-picker';
import type { Issue } from '@/data/issues';
import { useIssuesStore } from '@/store/issues-store';

type IssueRef = Pick<Issue, 'id' | 'priority' | 'status'>;

/**
 * A task's priority as a glyph-only picker bound to the issues store: the
 * change is optimistic and rolls back, with a toast, if the server refuses it.
 * Each option shows how many loaded tasks sit at that priority.
 */
export function IssuePriorityPicker({ issue }: { issue: Pick<IssueRef, 'id' | 'priority'> }) {
   const updateIssuePriority = useIssuesStore((state) => state.updateIssuePriority);
   const filterByPriority = useIssuesStore((state) => state.filterByPriority);
   return (
      <PriorityPicker
         variant="icon"
         priority={issue.priority}
         onChange={(next) => updateIssuePriority(issue.id, next)}
         countFor={(id) => filterByPriority(id).length}
      />
   );
}

/** A task's status as a mark-only picker bound to the issues store, with per-status counts. */
export function IssueStatusPicker({ issue }: { issue: Pick<IssueRef, 'id' | 'status'> }) {
   const updateIssueStatus = useIssuesStore((state) => state.updateIssueStatus);
   const filterByStatus = useIssuesStore((state) => state.filterByStatus);
   return (
      <StatusPicker
         variant="icon"
         status={issue.status}
         options={ISSUE_STATUS_OPTIONS}
         onChange={(next) => updateIssueStatus(issue.id, next)}
         countFor={(id) => filterByStatus(id).length}
      />
   );
}
