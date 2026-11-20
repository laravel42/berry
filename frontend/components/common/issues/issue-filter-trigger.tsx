'use client';

import { ListFilterTrigger, useListFilters } from '@/components/common/filters/list-filters';
import { FilterTriggerButton } from '@/components/common/filters/list-filters-lazy';
import { useFilterStore } from '@/store/filter-store';
import { useIssuesStore } from '@/store/issues-store';
import { useState } from 'react';
import { useIssueFilterColumns } from './issue-filter-columns';

/**
 * The menu itself: subscribes to the issues and builds the filter columns,
 * which is the expensive part, so it is only mounted once the button is used.
 */
function IssueFilterMenu({ iconOnly, openOnMount }: { iconOnly: boolean; openOnMount: boolean }) {
   const issues = useIssuesStore((state) => state.issues);
   const { filters, setFilters } = useFilterStore();
   const issueFilterColumns = useIssueFilterColumns();

   const filter = useListFilters({
      data: issues,
      columns: issueFilterColumns,
      filters,
      onFiltersChange: setFilters,
   });

   return <ListFilterTrigger filter={filter} iconOnly={iconOnly} openOnMount={openOnMount} />;
}

/**
 * Standalone "Filter" button for the header toolbars, on the same row as
 * the issue count / Display options (Linear-style). The applied filter
 * chips live in <IssueFilterBar/>, which only shows up once at least one
 * filter is active.
 *
 * Until the button is first used it is a plain button that does not read the
 * issues or build any column, so a long task list does not pay for a menu
 * nobody opened.
 */
export function IssueFilterTrigger({ iconOnly = false }: { iconOnly?: boolean }) {
   const [armed, setArmed] = useState(false);

   if (armed) return <IssueFilterMenu iconOnly={iconOnly} openOnMount />;

   return <FilterTriggerButton iconOnly={iconOnly} onClick={() => setArmed(true)} />;
}
