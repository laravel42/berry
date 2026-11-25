'use client';

import { ActiveFilters } from '@/components/data-table-filter/components/active-filters';
import type {
   Column,
   DataTableFilterActions,
   FilterStrategy,
   FiltersState,
} from '@/components/data-table-filter/core/types';
import { FilterSelector } from '@/components/data-table-filter/components/filter-selector';
import { useEffect, useRef } from 'react';

/**
 * The filter UI proper. Everything that pulls the heavy filter widgets
 * (motion, slider, tabs, …) is imported here and nowhere else, and this module
 * is only reached through `list-filters-lazy.tsx`.
 */

export { ActiveFilters };

export interface OpenableFilterSelectorProps<TData> {
   filters: FiltersState;
   columns: Column<TData>[];
   actions: DataTableFilterActions;
   strategy: FilterStrategy;
   iconOnly?: boolean;
   /** Open the menu as soon as it mounts. */
   openOnMount: boolean;
}

/** The filter menu, opened as soon as it mounts when `openOnMount` is set. */
export function OpenableFilterSelector<TData>({
   openOnMount,
   ...props
}: OpenableFilterSelectorProps<TData>) {
   const wrapperRef = useRef<HTMLSpanElement>(null);

   // The click that asked for the menu landed on the light button; replay it on
   // the real trigger so the popover opens as if it had been there all along.
   useEffect(() => {
      if (openOnMount) wrapperRef.current?.querySelector('button')?.click();
   }, [openOnMount]);

   return (
      <span ref={wrapperRef} className="contents">
         <FilterSelector {...props} />
      </span>
   );
}
