'use client';

import { ListFilterTrigger, useListFilters } from '@/components/common/filters/list-filters';
import { useFilterStore } from '@/store/filter-store';
import { useIssuesStore } from '@/store/issues-store';
import { useIssueFilterColumns } from './issue-filter-columns';

/**
 * Standalone "Filter" button for the header toolbars, on the same row as
 * the issue count / Display options (Linear-style). The applied filter
 * chips live in <IssueFilterBar/>, which only shows up once at least one
 * filter is active.
 */
export function IssueFilterTrigger({ iconOnly = false }: { iconOnly?: boolean }) {
   const { issues } = useIssuesStore();
   const { filters, setFilters } = useFilterStore();
   const issueFilterColumns = useIssueFilterColumns();

   const filter = useListFilters({
      data: issues,
      columns: issueFilterColumns,
      filters,
      onFiltersChange: setFilters,
   });

   return <ListFilterTrigger filter={filter} iconOnly={iconOnly} />;
}
