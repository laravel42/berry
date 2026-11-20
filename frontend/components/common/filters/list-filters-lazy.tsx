'use client';

import { t } from '@/components/data-table-filter/lib/i18n';
import { Button } from '@/components/ui/button';
import { FilterIcon } from 'lucide-react';
import dynamic from 'next/dynamic';
import { lazy, Suspense } from 'react';
import type { ActiveFilters as ActiveFiltersComponent } from '@/components/data-table-filter/components/active-filters';
import type { OpenableFilterSelectorProps } from './list-filters-ui';

/**
 * Deferred loading for the filter UI, so lists that never filter do not
 * download it. The chunk is fetched when a filter is active (chip row) or when
 * the Filter button is first used (menu).
 */

/** The Filter button as the menu draws it, without any of the menu's code. */
export function FilterTriggerButton({
   iconOnly,
   onClick,
}: {
   iconOnly: boolean;
   onClick?: () => void;
}) {
   return (
      <Button
         size={iconOnly ? 'icon-sm' : 'sm'}
         variant="track"
         aria-label={t('filter', 'en')}
         title={iconOnly ? t('filter', 'en') : undefined}
         onClick={onClick}
      >
         <FilterIcon className="size-4" />
         {!iconOnly && <span>{t('filter', 'en')}</span>}
      </Button>
   );
}

// lazy() drops the component's generic, so TData is restored on the way out.
const OpenableFilterSelector = lazy(() =>
   import('./list-filters-ui').then((module) => ({ default: module.OpenableFilterSelector }))
) as <TData>(props: OpenableFilterSelectorProps<TData>) => React.ReactElement | null;

/** The menu, loaded on demand; the light button stands in while it arrives. */
export function LazyFilterSelector<TData>(props: OpenableFilterSelectorProps<TData>) {
   return (
      <Suspense fallback={<FilterTriggerButton iconOnly={props.iconOnly ?? false} />}>
         <OpenableFilterSelector<TData> {...props} />
      </Suspense>
   );
}

/** The chip row, loaded on demand; a same-height strip holds its place. */
export const LazyActiveFilters = dynamic(
   () => import('./list-filters-ui').then((module) => module.ActiveFilters),
   { ssr: false, loading: () => <div aria-hidden className="h-7 w-full" /> }
) as typeof ActiveFiltersComponent;
