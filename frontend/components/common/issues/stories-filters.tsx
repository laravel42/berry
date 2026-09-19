import type { Decorator } from '@storybook/nextjs-vite';
import { NuqsTestingAdapter } from 'nuqs/adapters/testing';
import type { FiltersState } from '@/components/data-table-filter/core/types';

/**
 * Filters the way a shared link carries them: `?filters=` in the URL.
 *
 * The preview wraps every story in a NuqsTestingAdapter with no query; this
 * one sits inside it, so the component under test reads these instead.
 */
export function withUrlFilters(
   filters: FiltersState,
   extra: Record<string, string> = {}
): Decorator {
   const UrlFilters: Decorator = (Story) => (
      <NuqsTestingAdapter searchParams={{ filters: JSON.stringify(filters), ...extra }}>
         <Story />
      </NuqsTestingAdapter>
   );
   return UrlFilters;
}

export const urgentOnly: FiltersState = [
   { columnId: 'priority', type: 'option', operator: 'is', values: ['urgent'] },
];

export const frontendAgentsOnly: FiltersState = [
   {
      columnId: 'assignee',
      type: 'option',
      operator: 'is any of',
      values: ['agent-fe', 'agent-be'],
   },
];
