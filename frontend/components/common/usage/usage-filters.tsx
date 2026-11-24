'use client';

import { RefreshCw } from 'lucide-react';
import { useTranslations } from 'next-intl';

import { SegmentedControl } from '@/components/common/segmented-control';
import { Button } from '@/components/ui/button';
import { USAGE_DAY_OPTIONS, type UsageQuery } from '@/lib/usage';

import { UsageProjectFilter } from './usage-project-filter';

interface Props {
   /**
    * `window` (Spend and Runs): the time range and the project. `live`
    * (Overview): the project only, because nothing there is windowed.
    */
   timeframe: 'window' | 'live';
   query: UsageQuery;
   onChange: (query: UsageQuery) => void;
}

/** Window length segmented control (`7 days`, `30 days`, `90 days`). */
export function UsageRangeControl({
   days,
   onChange,
   className,
}: {
   days: UsageQuery['days'];
   onChange: (days: UsageQuery['days']) => void;
   className?: string;
}) {
   const t = useTranslations('areas.usage.filters');
   return (
      <SegmentedControl
         aria-label={t('range')}
         value={days}
         onValueChange={onChange}
         className={className}
         options={USAGE_DAY_OPTIONS.map((option) => ({
            value: option,
            label: t('days', { count: option }),
         }))}
      />
   );
}

/** What every usage read is asking: how far back and on which project. */
export default function UsageFilters({ timeframe, query, onChange }: Props) {
   // A 20rem basis: beside the tabs when there is room, on its own line when
   // there is not, so the range control never shrinks past its buttons.
   return (
      <div className="flex flex-[1_1_20rem] flex-wrap items-center gap-2">
         {timeframe === 'window' ? (
            <UsageRangeControl
               days={query.days}
               onChange={(days) => onChange({ ...query, days })}
            />
         ) : null}

         <UsageProjectFilter
            projectId={query.projectId ?? null}
            onChange={(projectId) => onChange({ ...query, projectId })}
         />
      </div>
   );
}

/**
 * When the numbers on screen arrived, and a way to ask again. It sits in the
 * page's title row, a meta line in the mono face a step under the body.
 */
export function UsageUpdated({
   lastUpdated,
   loading,
   onRefresh,
}: {
   lastUpdated: Date | null;
   loading: boolean;
   onRefresh: () => void;
}) {
   const t = useTranslations('areas.usage.filters');
   return (
      <span className="flex items-center gap-1 font-mono text-2xs text-muted-foreground tabular-nums">
         {lastUpdated ? t('updated', { when: lastUpdated.toLocaleTimeString() }) : t('never')}
         <Button
            size="icon-sm"
            variant="ghost"
            aria-label={t('refresh')}
            disabled={loading}
            onClick={onRefresh}
         >
            <RefreshCw className="size-3.5" />
         </Button>
      </span>
   );
}
