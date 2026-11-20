'use client';

import { ListFilterTrigger, useListFilters } from '@/components/common/filters/list-filters';
import { t } from '@/components/data-table-filter/lib/i18n';
import { Button } from '@/components/ui/button';
import { useFilterStore } from '@/store/filter-store';
import { useIssuesStore } from '@/store/issues-store';
import { FilterIcon } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { useIssueFilterColumns } from './issue-filter-columns';

/**
 * The menu itself: subscribes to the issues and builds the filter columns,
 * which is the expensive part, so it is only mounted once the button is used.
 */
function IssueFilterMenu({ iconOnly, openOnMount }: { iconOnly: boolean; openOnMount: boolean }) {
   const issues = useIssuesStore((state) => state.issues);
   const { filters, setFilters } = useFilterStore();
   const issueFilterColumns = useIssueFilterColumns();
   const wrapperRef = useRef<HTMLSpanElement>(null);

   const filter = useListFilters({
      data: issues,
      columns: issueFilterColumns,
      filters,
      onFiltersChange: setFilters,
   });

   // The click that mounted the menu landed on the light button; replay it on
   // the real trigger so the popover opens as if it had been there all along.
   useEffect(() => {
      if (openOnMount) wrapperRef.current?.querySelector('button')?.click();
   }, [openOnMount]);

   return (
      <span ref={wrapperRef} className="contents">
         <ListFilterTrigger filter={filter} iconOnly={iconOnly} />
      </span>
   );
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

   return (
      <Button
         size={iconOnly ? 'icon-sm' : 'sm'}
         variant="track"
         aria-label={t('filter', 'en')}
         title={iconOnly ? t('filter', 'en') : undefined}
         onClick={() => setArmed(true)}
      >
         <FilterIcon className="size-4" />
         {!iconOnly && <span>{t('filter', 'en')}</span>}
      </Button>
   );
}
