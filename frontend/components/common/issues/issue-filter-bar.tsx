'use client';

import { ActiveFilters } from '@/components/data-table-filter/components/active-filters';
import { useDataTableFilters } from '@/components/data-table-filter/hooks/use-data-table-filters';
import { IssueFilterBarActions } from '@/components/common/issues/issue-filter-bar-actions';
import { useFilterStore } from '@/store/filter-store';
import { useIssuesStore } from '@/store/issues-store';
import { isPropertyColumnId, useIssueFilterColumns } from './issue-filter-columns';

/**
 * The applied-filters row: chips wrap on the left. Clear / save actions can
 * sit on the right here, or be omitted when the page header owns them.
 */
export function IssueFilterBar({
   showActions = true,
}: {
   /** When false, Clear / save live elsewhere (e.g. the Tasks header). */
   showActions?: boolean;
}) {
   const { issues } = useIssuesStore();
   const { filters, setFilters } = useFilterStore();
   const issueFilterColumns = useIssueFilterColumns();

   const knownFilters = filters.filter(
      (filter) =>
         isPropertyColumnId(filter.columnId) ||
         issueFilterColumns.some((column) => column.id === filter.columnId)
   );
   const { columns, actions, strategy } = useDataTableFilters({
      strategy: 'client',
      data: issues,
      columnsConfig: issueFilterColumns,
      filters: knownFilters,
      onFiltersChange: setFilters,
   });

   if (filters.length === 0) return null;

   return (
      <div className="flex w-full items-start gap-2 border-b border-border/60 bg-container px-6 py-2">
         <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <ActiveFilters
               columns={columns}
               filters={filters}
               actions={actions}
               strategy={strategy}
            />
         </div>
         {showActions ? <IssueFilterBarActions className="shrink-0 self-start" /> : null}
      </div>
   );
}
