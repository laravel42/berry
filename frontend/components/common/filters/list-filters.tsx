'use client';

import { ActiveFilters } from '@/components/data-table-filter/components/active-filters';
import { FilterSelector } from '@/components/data-table-filter/components/filter-selector';
import { dateFilterOperators } from '@/components/data-table-filter/core/operators';
import type {
   Column,
   ColumnConfig,
   DataTableFilterActions,
   FilterModel,
   FilterStrategy,
   FiltersState,
} from '@/components/data-table-filter/core/types';
import { useDataTableFilters } from '@/components/data-table-filter/hooks/use-data-table-filters';
import {
   dateFilterFn,
   multiOptionFilterFn,
   numberFilterFn,
   optionFilterFn,
   textFilterFn,
} from '@/components/data-table-filter/lib/filter-fns';
import { Button } from '@/components/ui/button';
import { cn } from '@/lib/utils';
import { FilterXIcon } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useCallback, useMemo } from 'react';

/**
 * The Linear-style list filter the Tasks page uses, for any list.
 *
 * A list describes what it can be narrowed by as bazza/ui column configs, and
 * holds a `FiltersState` wherever suits it (the URL, a store, component state).
 * `useListFilters` binds the two; `ListFilterTrigger` is the "Filter" button
 * for the toolbar and `ListFilterBar` is the chip row under it, which only
 * shows up once a filter is on. `applyListFilters` narrows the rows with the
 * same operators the chips offer.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any -- bazza's own column typing.
export type ListFilterColumns<TData> = ReadonlyArray<ColumnConfig<TData, any, any, any>>;

export interface ListFilterController<TData> {
   columns: Column<TData>[];
   /** The active filters this list has a column for. */
   filters: FiltersState;
   actions: DataTableFilterActions;
   strategy: FilterStrategy;
   clear: () => void;
}

interface UseListFiltersOptions<TData> {
   /** The rows before filtering, so the menu can count each value. */
   data: TData[];
   columns: ListFilterColumns<TData>;
   filters: FiltersState;
   onFiltersChange: React.Dispatch<React.SetStateAction<FiltersState>>;
}

/**
 * Filters for a column the list does not have are left out: a link or a
 * stale store can carry one, and the chip row would have nothing to draw.
 */
export function useListFilters<TData>({
   data,
   columns,
   filters,
   onFiltersChange,
}: UseListFiltersOptions<TData>): ListFilterController<TData> {
   const known = useMemo(
      () => filters.filter((filter) => columns.some((column) => column.id === filter.columnId)),
      [filters, columns]
   );

   const table = useDataTableFilters({
      strategy: 'client',
      data,
      columnsConfig: columns,
      filters: known,
      onFiltersChange,
   });

   const clear = useCallback(() => onFiltersChange([]), [onFiltersChange]);

   return {
      columns: table.columns as Column<TData>[],
      filters: known,
      actions: table.actions,
      strategy: table.strategy,
      clear,
   };
}

/** The "Filter" button: pick a field, then its values. */
export function ListFilterTrigger<TData>({
   filter,
   iconOnly = false,
}: {
   filter: ListFilterController<TData>;
   iconOnly?: boolean;
}) {
   return (
      <FilterSelector
         columns={filter.columns}
         filters={filter.filters}
         actions={filter.actions}
         strategy={filter.strategy}
         iconOnly={iconOnly}
      />
   );
}

/** Drops every filter on the list. */
export function ListFilterClear({
   onClear,
   className,
}: {
   onClear: () => void;
   className?: string;
}) {
   const t = useTranslations('common.filters');
   return (
      <Button size="xs" variant="destructive" className={className} onClick={onClear}>
         <FilterXIcon className="size-4" />
         {t('clear')}
      </Button>
   );
}

/**
 * The applied-filters row: chips wrap on the left, Clear sits on the right
 * with any `actions` the list adds. Renders nothing while no filter is on.
 */
export function ListFilterBar<TData>({
   filter,
   actions,
   className,
}: {
   filter: ListFilterController<TData>;
   actions?: React.ReactNode;
   className?: string;
}) {
   if (filter.filters.length === 0) return null;

   return (
      <div
         className={cn(
            'flex w-full shrink-0 items-start gap-2 border-b border-border/60 bg-container px-6 py-2',
            className
         )}
      >
         <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
            <ActiveFilters
               columns={filter.columns}
               filters={filter.filters}
               actions={filter.actions}
               strategy={filter.strategy}
            />
         </div>
         <div className="flex shrink-0 items-center gap-1 self-start">
            {actions}
            <ListFilterClear onClear={filter.clear} />
         </div>
      </div>
   );
}

/* -------------------------------------------------------------------------- */
/*                                  Matching                                  */
/* -------------------------------------------------------------------------- */

/**
 * Whether one value passes one filter, honouring its operator (is / is not /
 * include / exclude / before / …). A filter with no values yet passes.
 */
export function matchesFilter(value: unknown, filter: FilterModel): boolean {
   switch (filter.type) {
      case 'option':
         return optionFilterFn(String(value ?? ''), filter) ?? true;
      case 'multiOption':
         return multiOptionFilterFn((value as string[]) ?? [], filter) ?? true;
      case 'date': {
         // A singular operator with a leftover range would throw inside the
         // filter function, so the extra value is dropped instead.
         const operators = dateFilterOperators as Record<string, { target: string } | undefined>;
         const singular = operators[String(filter.operator)]?.target === 'single';
         const normalised =
            singular && filter.values.length > 1
               ? { ...filter, values: filter.values.slice(0, 1) }
               : filter;
         return dateFilterFn(value as Date, normalised) ?? true;
      }
      case 'text':
         return textFilterFn(String(value ?? ''), filter) ?? true;
      case 'number':
         return numberFilterFn(Number(value ?? 0), filter) ?? true;
      default:
         return true;
   }
}

/** The rows that pass every filter; filters without a column are ignored. */
export function applyListFilters<TData>(
   rows: TData[],
   columns: ListFilterColumns<TData>,
   filters: FiltersState
): TData[] {
   const active = filters.flatMap((filter) => {
      const column = columns.find((entry) => entry.id === filter.columnId);
      return column ? [{ filter, column }] : [];
   });
   if (active.length === 0) return rows;

   return rows.filter((row) =>
      active.every(({ filter, column }) => matchesFilter(column.accessor(row), filter))
   );
}

/* -------------------------------------------------------------------------- */
/*                            Click-to-filter helpers                         */
/* -------------------------------------------------------------------------- */

/** The values an `is` / `is any of` filter on `columnId` currently keeps. */
export function selectedOptionValues(filters: FiltersState, columnId: string): string[] {
   const filter = filters.find((entry) => entry.columnId === columnId);
   if (!filter || filter.type !== 'option') return [];
   if (filter.operator !== 'is' && filter.operator !== 'is any of') return [];
   return filter.values as string[];
}

/**
 * Adds `value` to the option filter on `columnId`, or takes it out if it is
 * already there. Used by panels whose rows filter the list when clicked.
 */
export function toggleOptionValue(
   filters: FiltersState,
   columnId: string,
   value: string
): FiltersState {
   const current = selectedOptionValues(filters, columnId);
   const values = current.includes(value)
      ? current.filter((entry) => entry !== value)
      : [...current, value];
   const rest = filters.filter((entry) => entry.columnId !== columnId);
   if (values.length === 0) return rest;
   return [
      ...rest,
      { columnId, type: 'option', operator: values.length > 1 ? 'is any of' : 'is', values },
   ];
}
