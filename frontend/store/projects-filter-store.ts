'use client';

import type { FiltersState } from '@/components/data-table-filter/core/types';
import { parseAsString, parseAsStringLiteral, useQueryStates } from 'nuqs';
import { useFilterStore } from './filter-store';

export type ProjectsSort =
   'title-asc' | 'title-desc' | 'date-asc' | 'date-desc' | 'status-asc' | 'status-desc';

const SORTS: ProjectsSort[] = [
   'title-asc',
   'title-desc',
   'date-asc',
   'date-desc',
   'status-asc',
   'status-desc',
];

export interface ProjectsFilterState {
   /** The list filters (bazza/ui FiltersState), under `?filters=`. */
   filters: FiltersState;
   setFilters: React.Dispatch<React.SetStateAction<FiltersState>>;
   sort: ProjectsSort;
   /** Free-text search over project names. */
   query: string;

   setSort: (sort: ProjectsSort) => void;
   setQuery: (query: string) => void;
   /** Drops the filters and the search together. */
   clearFilters: () => void;
   hasActiveFilters: () => boolean;
}

const parsers = {
   q: parseAsString.withDefault(''),
   sort: parseAsStringLiteral(SORTS).withDefault('title-asc'),
};

/** Projects page filters, search and sorting, URL-synced via nuqs. */
export function useProjectsFilterStore(): ProjectsFilterState {
   const [state, setState] = useQueryStates(parsers, { history: 'replace' });
   const { filters, setFilters, clearFilters } = useFilterStore();

   return {
      filters,
      setFilters,
      sort: state.sort,
      query: state.q,

      setSort: (sort) => setState({ sort: sort === 'title-asc' ? null : sort }),
      setQuery: (query) => setState({ q: query.trim() === '' ? null : query }),
      clearFilters: () => {
         clearFilters();
         void setState({ q: null });
      },
      hasActiveFilters: () => filters.length > 0 || state.q.trim() !== '',
   };
}
